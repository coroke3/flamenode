import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { CurrentUserUnavailableError } from "@/lib/auth/currentUser";
import { isTransientDbError } from "@/lib/db/transientDbErrorCore";
import { requireAdminWrite, type WriteGuardResult } from "@/lib/auth/writeGuard";
import { requireSameOriginWrite } from "@/lib/auth/writeOriginGuard";
import { parseLegacyImportText, type LegacyParsedFile } from "@/lib/import/legacy/parse";
import {
  legacyImportCpuBudgetErrors,
  MAX_LEGACY_IMPORT_SELECTED_ROWS,
} from "@/lib/import/legacy/cpuBudget";
import {
  selectLegacyParsedFileRange,
  type LegacyImportFileRange,
} from "@/lib/import/legacy/range";
import {
  MAX_LEGACY_VIDEO_FIELD_DECISIONS,
  normalizeLegacyFiles,
  type CanonicalVisibility,
  type LegacyImportStrategy,
  type LegacyVideoFieldDecision,
} from "@/lib/import/legacy/normalize";
import {
  applyLegacyImportPlanStep,
  legacyApplyResultFromProgress,
  LEGACY_IMPORT_QUESTION_STEP_SIZE,
  LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
  LEGACY_IMPORT_X_USER_STEP_SIZE,
} from "@/lib/import/legacy/apply";
import { preflightLegacyImportPlan } from "@/lib/import/legacy/preflight";
import {
  claimLegacyImportPreview,
  createLegacyImportPreview,
  estimateLegacyImportStoredPlanBytes,
  LegacyImportPreviewError,
  LEGACY_IMPORT_PLAN_WARN_BYTES,
  MAX_STORED_PLAN_BYTES,
  type LegacyImportApplyProgress,
} from "@/lib/import/legacy/previewStore";
import type { CanonicalLegacyPlan } from "@/lib/import/legacy/normalize";

export const dynamic = "force-dynamic";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = MAX_LEGACY_IMPORT_SELECTED_ROWS;
const MAX_FIELD_DECISIONS_BYTES = 16 * 1024;

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
    const retryable = isTransientDbError(cause);
    return error(
      retryable
        ? "CloudflareまたはR2が一時的に応答できませんでした。"
        : "preview planを確認できませんでした。再度プレビューしてください。",
      retryable ? 503 : 409,
      { retryable, requires_repreview: !retryable },
    );
  }
  const status = cause.code === "bucket_unavailable" ? 503 : cause.code === "already_claimed" ? 423 : 409;
  const requiresRepreview = [
    "not_found",
    "expired",
    "owner_mismatch",
    "hash_mismatch",
    "invalid_record",
    "invalid_token",
  ].includes(cause.code);
  return error(cause.message, status, {
    preview_error_code: cause.code,
    requires_repreview: requiresRepreview,
    retryable: !requiresRepreview && (
      cause.code === "already_claimed" ||
      cause.code === "bucket_unavailable" ||
      cause.code === "claim_conflict"
    ),
  });
}

function isTransientApplyFailure(cause: unknown): boolean {
  return isTransientDbError(cause) || (
    cause instanceof LegacyImportPreviewError &&
    (cause.code === "already_claimed" ||
      cause.code === "bucket_unavailable" ||
      cause.code === "claim_conflict")
  );
}

function videoFieldDecisions(formData: FormData): LegacyVideoFieldDecision[] {
  const raw = stringField(formData, "video_custom_field_decisions");
  if (!raw) return [];
  if (new TextEncoder().encode(raw).byteLength > MAX_FIELD_DECISIONS_BYTES) {
    throw new Error("動画の未対応項目の指定が大きすぎます。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("動画の未対応項目の指定をJSONとして読み取れませんでした。");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_LEGACY_VIDEO_FIELD_DECISIONS) {
    throw new Error(`動画の未対応項目の指定は最大${MAX_LEGACY_VIDEO_FIELD_DECISIONS}件です。`);
  }

  return parsed.map((item, index): LegacyVideoFieldDecision => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`動画の未対応項目の指定${index + 1}件目が不正です。`);
    }
    const record = item as Record<string, unknown>;
    const sourceKey = typeof record.source_key === "string" ? record.source_key : "";
    if (record.action === "ignore") {
      if (Object.keys(record).some((key) => key !== "source_key" && key !== "action")) {
        throw new Error(`動画項目「${sourceKey || index + 1}」の除外指定に不明な値があります。`);
      }
      return { source_key: sourceKey, action: "ignore" };
    }
    if (record.action === "custom_question") {
      if (
        Object.keys(record).some(
          (key) => key !== "source_key" && key !== "action" && key !== "question_label",
        ) ||
        typeof record.question_label !== "string"
      ) {
        throw new Error(`動画項目「${sourceKey || index + 1}」の質問文Q指定が不正です。`);
      }
      return {
        source_key: sourceKey,
        action: "custom_question",
        question_label: record.question_label,
      };
    }
    throw new Error(`動画項目「${sourceKey || index + 1}」の処理方法が不正です。`);
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

function applyProgressSummary(
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
): { stage: string; index: number; completed: number; total: number } {
  const softwareCount = new Set(
    plan.videoSoftwares
      .map((row) => row.label.trim().replace(/\s+/g, " ").toLowerCase())
      .filter(Boolean),
  ).size;
  const sizes = {
    system_user: 1,
    x_users: Math.max(1, Math.ceil(plan.xUsers.length / LEGACY_IMPORT_X_USER_STEP_SIZE)),
    softwares: Math.max(1, Math.ceil(softwareCount / LEGACY_IMPORT_SOFTWARE_STEP_SIZE)),
    events: Math.max(1, plan.events.length),
    custom_questions: Math.max(
      1,
      Math.ceil(plan.eventCustomQuestions.length / LEGACY_IMPORT_QUESTION_STEP_SIZE),
    ),
    videos: Math.max(1, plan.videos.length),
  };
  const stages = ["system_user", "x_users", "softwares", "events", "custom_questions", "videos"] as const;
  const total = stages.reduce((sum, stage) => sum + sizes[stage], 0);
  const completed = progress.stage === "complete"
    ? total
    : stages
        .slice(0, stages.indexOf(progress.stage))
        .reduce((sum, stage) => sum + sizes[stage], 0) + progress.index;
  return { stage: progress.stage, index: progress.index, completed, total };
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
      if (claimed.completed || claimed.progress.stage === "complete") {
        const expiresAt = await claimed.complete();
        return NextResponse.json({
          ok: true,
          mode,
          plan_hash: claimed.planHash,
          attempt: claimed.attempt,
          continuation_required: false,
          expires_at: expiresAt,
          progress: applyProgressSummary(claimed.plan, claimed.progress),
          result: {
            ...legacyApplyResultFromProgress(claimed.plan, claimed.progress),
            complete: true,
          },
        });
      }

      const applyCpuBudgetErrors = legacyImportCpuBudgetErrors(claimed.plan);
      if (applyCpuBudgetErrors.length > 0) {
        await claimed.release().catch(() => undefined);
        return error(
          "Cloudflare Workerの1リクエスト上限を超える入力です。範囲または1作品内の関連データを分割してください。",
          409,
          {
            requires_repreview: true,
            errors: applyCpuBudgetErrors,
          },
        );
      }

      // 1 HTTP リクエストでは原子ステップを1件だけ確定する。
      // 各ステップは複数のD1呼び出しとR2 CASを使うため、ここでループすると
      // Cloudflare Workersのsubrequest/CPU上限を入力件数に応じて超過しうる。
      const step = await applyLegacyImportPlanStep(db, claimed.plan, {
        actorAuthUserId: user.id,
        strategy: claimed.strategy,
        previewToken,
        planHash,
        progress: claimed.progress,
      });
      const expiresAt = await claimed.advance(step.progress);

      return NextResponse.json({
        ok: true,
        mode,
        plan_hash: claimed.planHash,
        attempt: claimed.attempt,
        continuation_required: !step.complete,
        expires_at: expiresAt,
        progress: applyProgressSummary(claimed.plan, step.progress),
        result: {
          ...legacyApplyResultFromProgress(claimed.plan, step.progress),
          complete: step.complete,
        },
      });
    } catch (cause) {
      await claimed.release().catch(() => undefined);
      const retryable = isTransientApplyFailure(cause);
      const requiresRepreview = !retryable;
      const baseMessage = retryable
        ? "CloudflareまたはD1/R2が一時的に応答できませんでした。"
        : cause instanceof Error
          ? cause.message
          : "インポートを確定できませんでした。";
      return error(
        `${baseMessage} ${requiresRepreview ? "入力とDB状態を再確認してください。" : "preview planは保持されています。同じ内容で再試行できます。"}`,
        retryable ? 503 : 409,
        {
        retryable,
        requires_repreview: requiresRepreview,
        plan_hash: claimed.planHash,
        attempt: claimed.attempt,
        progress: applyProgressSummary(claimed.plan, claimed.progress),
      });
    }
  }

  const files = formData.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) return error("JSON・CSV・TSVファイルを選択してください。");
  if (files.length > MAX_FILES) return error(`ファイル数は最大${MAX_FILES}件です。`);

  let totalBytes = 0;
  const parsed: LegacyParsedFile[] = [];
  const fileRanges: LegacyImportFileRange[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) return error(`${file.name}: 1ファイル2MBまでです。大きいファイルは物理分割してください。`);
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) return error("ファイル合計は4MBまでです。複数回に分けてください。");
    const content = await file.text();
    try {
      const parsedFile = parseLegacyImportText(file.name, content);
      const fileIndex = parsed.length;
      const ranged = selectLegacyParsedFileRange(parsedFile, {
        start: stringField(formData, `range_start_${fileIndex}`),
        end: stringField(formData, `range_end_${fileIndex}`),
      });
      parsed.push(ranged.file);
      fileRanges.push(ranged.range);
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : `${file.name}: 解析に失敗しました。`);
    }
  }

  const sourceRowCount = fileRanges.reduce((sum, range) => sum + range.sourceRows, 0);
  const rowCount = parsed.reduce((sum, file) => sum + file.rows.length, 0);
  if (rowCount > MAX_ROWS) {
    return error(
      `今回の選択範囲は${rowCount.toLocaleString()}行です。合計${MAX_ROWS}行以下になるよう、各ファイルの開始・終了位置を狭めてください。`,
      413,
      { file_ranges: fileRanges, requires_repreview: false },
    );
  }

  let fieldDecisions: LegacyVideoFieldDecision[];
  try {
    fieldDecisions = videoFieldDecisions(formData);
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "動画の未対応項目の指定が不正です。");
  }
  const selectedStrategy = strategy(formData.get("strategy"));
  const plan = normalizeLegacyFiles(parsed, {
    eventVisibility: visibility(formData.get("event_visibility")),
    videoVisibility: visibility(formData.get("video_visibility")),
    videoFieldDecisions: fieldDecisions,
  });

  const cpuBudgetErrors = legacyImportCpuBudgetErrors(plan);
  if (cpuBudgetErrors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        mode,
        message: "Cloudflare Workerの1リクエスト上限を超える入力です。範囲または1作品内の関連データを分割してください。",
        file_ranges: fileRanges,
        warnings: plan.warnings.slice(0, 100),
        errors: cpuBudgetErrors,
        video_custom_field_candidates: plan.unmappedVideoFields,
      },
      { status: 413 },
    );
  }

  const summary = {
    inputFiles: files.length,
    sourceRows: sourceRowCount,
    inputRows: rowCount,
    events: plan.events.length,
    eventStaff: plan.eventStaff.length,
    videos: plan.videos.length,
    videoEvents: plan.videoEvents.length,
    videoMembers: plan.videoMembers.length,
    videoChapters: plan.videoChapters.length,
    xUsers: plan.xUsers.length,
    softwares: plan.videoSoftwares.length,
    customQuestions: plan.eventCustomQuestions.length,
    customAnswers: plan.videoCustomAnswers.length,
    unmappedVideoFields: plan.unmappedVideoFields.length,
    warnings: plan.warnings.length,
    errors: plan.errors.length,
  };

  if (plan.errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        mode,
        summary,
        file_ranges: fileRanges,
        warnings: plan.warnings.slice(0, 100),
        errors: plan.errors.slice(0, 100),
        video_custom_field_candidates: plan.unmappedVideoFields,
      },
      { status: 422 },
    );
  }

  const storedPlanBytes = estimateLegacyImportStoredPlanBytes({
    authUserId: user.id,
    strategy: selectedStrategy,
    plan,
  });
  if (storedPlanBytes > MAX_STORED_PLAN_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        mode,
        message: `正規化後planがCloudflare用上限512KBを超えました。開始・終了位置を狭めてください。`,
        summary,
        file_ranges: fileRanges,
        warnings: plan.warnings.slice(0, 100),
        errors: ["applyは各リクエストでplanを検証するため、巨大planを保存するとWorker CPU上限を超えます。"],
        video_custom_field_candidates: plan.unmappedVideoFields,
      },
      { status: 413 },
    );
  }

  let preflight;
  try {
    preflight = await preflightLegacyImportPlan(db, plan, selectedStrategy);
  } catch (cause) {
    return error(
      cause instanceof Error ? cause.message : "現在のDB状態へ適用できないplanです。",
      409,
      {
        mode,
        summary,
        file_ranges: fileRanges,
        warnings: plan.warnings.slice(0, 100),
        requires_repreview: false,
      },
    );
  }

  let credential;
  try {
    credential = await createLegacyImportPreview(getEnv().BUCKET, {
      authUserId: user.id,
      strategy: selectedStrategy,
      plan,
      skipExistingEventIds: selectedStrategy === "skip_existing" ? preflight.existingEventIds : [],
      skipExistingVideoIds: selectedStrategy === "skip_existing" ? preflight.existingVideoIds : [],
    });
  } catch (cause) {
    return previewErrorResponse(cause);
  }

  const previewWarnings = plan.warnings.slice(0, 100);
  if (storedPlanBytes > LEGACY_IMPORT_PLAN_WARN_BYTES) {
    previewWarnings.unshift(
      `正規化後のplanがCloudflare CPU目安の80%を超えています（約${Math.ceil(storedPlanBytes / 1024).toLocaleString()}KB / 上限512KB）。開始・終了位置をさらに狭めると安定します。`,
    );
  }

  return NextResponse.json({
    ok: true,
    mode,
    summary,
    warnings: previewWarnings,
    errors: [],
    preview_token: credential.previewToken,
    plan_hash: credential.planHash,
    expires_at: credential.expiresAt,
    strategy: selectedStrategy,
    file_ranges: fileRanges,
    video_custom_field_candidates: plan.unmappedVideoFields,
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
