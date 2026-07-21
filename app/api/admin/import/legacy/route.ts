import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { CurrentUserUnavailableError } from "@/lib/auth/currentUser";
import { requireAdminWrite, type WriteGuardResult } from "@/lib/auth/writeGuard";
import { requireSameOriginWrite } from "@/lib/auth/writeOriginGuard";
import { parseLegacyImportText, type LegacyParsedFile } from "@/lib/import/legacy/parse";
import {
  normalizeLegacyFiles,
  type CanonicalVisibility,
  type LegacyImportStrategy,
} from "@/lib/import/legacy/normalize";
import { applyLegacyImportPlan } from "@/lib/import/legacy/apply";
import { preflightLegacyImportPlan } from "@/lib/import/legacy/preflight";
import {
  claimLegacyImportPreview,
  createLegacyImportPreview,
  LegacyImportPreviewError,
} from "@/lib/import/legacy/previewStore";

export const dynamic = "force-dynamic";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_ROWS = 5000;

function error(
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

function visibility(value: FormDataEntryValue | null): CanonicalVisibility {
  return value === "private" ? "private" : "public";
}

function strategy(value: FormDataEntryValue | null): LegacyImportStrategy {
  if (value === "skip_existing" || value === "replace_imported") return value;
  return "create_only";
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function previewErrorResponse(cause: unknown): NextResponse {
  if (!(cause instanceof LegacyImportPreviewError)) {
    return error("preview planを確認できませんでした。再度プレビューしてください。", 409);
  }
  const status = cause.code === "bucket_unavailable" ? 503 : cause.code === "already_claimed" ? 423 : 409;
  return error(cause.message, status, {
    preview_error_code: cause.code,
    requires_repreview: [
      "not_found",
      "expired",
      "owner_mismatch",
      "hash_mismatch",
      "invalid_record",
      "invalid_token",
    ].includes(cause.code),
  });
}

function writeGuardErrorResponse(
  guard: Exclude<WriteGuardResult, { ok: true }>,
): NextResponse {
  const status =
    guard.reason === "unauthenticated"
      ? 401
      : guard.reason === "db_unavailable" ||
          guard.reason === "maintenance_mode" ||
          guard.reason === "cost_guard_blocked"
        ? 503
        : 403;
  return error(guard.reason, status);
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = await requireSameOriginWrite(request);
  if (!origin.ok) return error(origin.error, origin.status);
  let writeAccess: WriteGuardResult;
  try {
    writeAccess = await requireAdminWrite("admin_legacy_import");
  } catch (cause) {
    if (cause instanceof CurrentUserUnavailableError) {
      return error(cause.code, 503);
    }
    throw cause;
  }
  if (!writeAccess.ok) return writeGuardErrorResponse(writeAccess);
  const { db, user } = writeAccess;

  const formData = await request.formData().catch(() => null);
  if (!formData) return error("multipart/form-data を読み取れませんでした。");
  const mode = formData.get("mode") === "apply" ? "apply" : "preview";

  if (mode === "apply") {
    const previewToken = stringField(formData, "preview_token");
    const planHash = stringField(formData, "plan_hash");
    if (!previewToken || !planHash) {
      return error("先にプレビューを実行してください。", 409, { requires_repreview: true });
    }

    let claimed: Awaited<ReturnType<typeof claimLegacyImportPreview>>;
    try {
      claimed = await claimLegacyImportPreview(getEnv().BUCKET, {
        authUserId: user.id,
        previewToken,
        planHash,
      });
    } catch (cause) {
      return previewErrorResponse(cause);
    }

    try {
      await preflightLegacyImportPlan(db, claimed.plan, claimed.strategy);
      const result = await applyLegacyImportPlan(db, claimed.plan, {
        actorAuthUserId: user.id,
        strategy: claimed.strategy,
      });
      await claimed.complete();
      return NextResponse.json({
        ok: true,
        mode,
        plan_hash: claimed.planHash,
        attempt: claimed.attempt,
        result,
      });
    } catch (cause) {
      await claimed.release().catch(() => undefined);
      const baseMessage = cause instanceof Error ? cause.message : "インポートを確定できませんでした。";
      const createOnlyRecovery =
        claimed.strategy === "create_only"
          ? " 書き込み前検査または適用中に停止しました。部分書き込みが疑われる場合は、同じファイルを再プレビューし、「過去の旧形式インポート行だけ置換」で再開してください。"
          : " preview planは保持されています。同じ内容で再試行できます。";
      return error(`${baseMessage}${createOnlyRecovery}`, 409, {
        retryable: claimed.strategy !== "create_only",
        requires_repreview: claimed.strategy === "create_only",
        plan_hash: claimed.planHash,
        attempt: claimed.attempt,
      });
    }
  }

  const files = formData.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) return error("JSON・CSV・TSVファイルを選択してください。");
  if (files.length > MAX_FILES) return error(`ファイル数は最大${MAX_FILES}件です。`);

  let totalBytes = 0;
  const parsed: LegacyParsedFile[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) return error(`${file.name}: 1ファイル5MBまでです。`);
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) return error("ファイル合計は12MBまでです。");
    const content = await file.text();
    try {
      parsed.push(parseLegacyImportText(file.name, content));
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : `${file.name}: 解析に失敗しました。`);
    }
  }

  const selectedStrategy = strategy(formData.get("strategy"));
  const plan = normalizeLegacyFiles(parsed, {
    eventVisibility: visibility(formData.get("event_visibility")),
    videoVisibility: visibility(formData.get("video_visibility")),
  });
  const rowCount = parsed.reduce((sum, file) => sum + file.rows.length, 0);
  if (rowCount > MAX_ROWS) return error(`1回の入力は最大${MAX_ROWS}行です。`);

  const summary = {
    inputFiles: files.length,
    inputRows: rowCount,
    events: plan.events.length,
    eventStaff: plan.eventStaff.length,
    videos: plan.videos.length,
    videoEvents: plan.videoEvents.length,
    videoMembers: plan.videoMembers.length,
    videoChapters: plan.videoChapters.length,
    xUsers: plan.xUsers.length,
    softwares: plan.videoSoftwares.length,
    warnings: plan.warnings.length,
    errors: plan.errors.length,
  };

  if (plan.errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        mode,
        summary,
        warnings: plan.warnings.slice(0, 100),
        errors: plan.errors.slice(0, 100),
      },
      { status: 422 },
    );
  }

  let credential;
  try {
    credential = await createLegacyImportPreview(getEnv().BUCKET, {
      authUserId: user.id,
      strategy: selectedStrategy,
      plan,
    });
  } catch (cause) {
    return previewErrorResponse(cause);
  }

  return NextResponse.json({
    ok: true,
    mode,
    summary,
    warnings: plan.warnings.slice(0, 100),
    errors: [],
    preview_token: credential.previewToken,
    plan_hash: credential.planHash,
    expires_at: credential.expiresAt,
    strategy: selectedStrategy,
    preview: {
      events: plan.events.slice(0, 20).map(({ id, title, visibility_status }) => ({ id, title, visibility_status })),
      videos: plan.videos.slice(0, 50).map(({ id, title, creator_display_name, visibility_status }) => ({
        id,
        title,
        creator_display_name,
        visibility_status,
      })),
    },
  });
}
