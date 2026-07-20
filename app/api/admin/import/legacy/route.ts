import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { parseLegacyImportText } from "@/lib/import/legacy/parse";
import {
  normalizeLegacyFiles,
  type CanonicalVisibility,
  type LegacyImportStrategy,
} from "@/lib/import/legacy/normalize";
import { applyLegacyImportPlan } from "@/lib/import/legacy/apply";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_ROWS = 5000;

function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, message }, { status });
}

function visibility(value: FormDataEntryValue | null): CanonicalVisibility {
  return value === "private" ? "private" : "public";
}

function strategy(value: FormDataEntryValue | null): LegacyImportStrategy {
  if (value === "skip_existing" || value === "replace_imported") return value;
  return "create_only";
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) return error("ログインが必要です。", 401);
  if (user.role !== "admin") return error("管理者のみ利用できます。", 403);

  const formData = await request.formData().catch(() => null);
  if (!formData) return error("multipart/form-data を読み取れませんでした。");
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) return error("JSON・CSV・TSVファイルを選択してください。");
  if (files.length > MAX_FILES) return error(`ファイル数は最大${MAX_FILES}件です。`);

  let totalBytes = 0;
  const parsed = [];
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
  const mode = formData.get("mode") === "apply" ? "apply" : "preview";
  if (mode === "preview") {
    return NextResponse.json({
      ok: plan.errors.length === 0,
      mode,
      summary,
      warnings: plan.warnings.slice(0, 100),
      errors: plan.errors.slice(0, 100),
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
  if (plan.errors.length > 0) return error("入力エラーを修正してから実行してください。", 422);
  const db = getDatabase();
  if (!db) return error("DBに接続できません。", 503);

  try {
    const result = await applyLegacyImportPlan(db, plan, {
      actorAuthUserId: user.id,
      strategy: strategy(formData.get("strategy")),
    });
    return NextResponse.json({ ok: true, mode, summary, result });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "インポートを確定できませんでした。", 409);
  }
}
