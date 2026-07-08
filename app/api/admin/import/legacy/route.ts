export const runtime = "edge";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { isLegacyImportToolEnabled } from "@/lib/import/legacy/featureFlag";
import { parseLegacyImportText } from "@/lib/import/legacy/parse";
import { splitLegacyPayload } from "@/lib/import/legacy/payload";
import { normalizeEventInfo, normalizeLegacyVideo } from "@/lib/import/legacy/normalize";
import { buildLegacyImportPlan } from "@/lib/import/legacy/plan";
import { buildDryRunResult } from "@/lib/import/legacy/dryRun";
import { applyLegacyImportPlan } from "@/lib/import/legacy/apply";
import { buildPreviewToken } from "@/lib/import/legacy/previewToken";
import { hashFiles, stableSha256 } from "@/lib/import/legacy/hash";
import { generateId } from "@/lib/utils/id";
import {
  MAX_IMPORT_FILES,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_PREVIEW_ROWS,
} from "@/lib/import/legacy/constants";
import type { ImportMode, ImportStrategy } from "@/lib/import/legacy/types";

interface JsonRequest {
  action?: "analyze" | "apply";
  files?: { name?: string; content?: string }[];
  previewToken?: string;
  anchorNow?: number;
  strategy?: {
    importMode?: string;
    strategy?: string;
    enqueueStaticRebuild?: boolean;
  };
}

function errorResponse(message: string, status: number, errors: string[] = []): NextResponse {
  return NextResponse.json({ ok: false, message, errors }, { status });
}

function normalizeImportMode(raw: unknown): ImportMode {
  if (raw === "archive" || raw === "preserve" || raw === "active_event" || raw === "draft") {
    return raw;
  }
  return "archive";
}

function normalizeStrategy(raw: unknown): ImportStrategy {
  if (raw === "create_only" || raw === "replace_imported" || raw === "skip_existing") return raw;
  // 後方互換: 旧ストラテジーをマッピング
  if (raw === "skip") return "skip_existing";
  return "skip_existing";
}

export async function POST(req: Request): Promise<Response> {
  if (!isLegacyImportToolEnabled()) {
    return NextResponse.json(
      { ok: false, message: "旧データ移行ツールは現在無効です。ENABLE_LEGACY_IMPORT_TOOL=true を設定してください。" },
      { status: 403 },
    );
  }

  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return errorResponse("forbidden", 403);
  }

  let body: JsonRequest;
  try {
    body = (await req.json()) as JsonRequest;
  } catch {
    return errorResponse("リクエストの JSON が不正です。", 400);
  }

  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) {
    return errorResponse("files が空です。", 400);
  }
  if (files.length > MAX_IMPORT_FILES) {
    return errorResponse(`ファイル数が上限 (${MAX_IMPORT_FILES}) を超えています。`, 413);
  }

  let totalChars = 0;
  for (const f of files) {
    const len = (f.content ?? "").length;
    totalChars += len;
    if (totalChars > MAX_IMPORT_TOTAL_BYTES * 2) {
      return errorResponse("ファイルの合計サイズが上限を超えています。", 413, ["size-limit"]);
    }
  }

  // パース・正規化
  const allEvents: unknown[] = [];
  const allVideos: unknown[] = [];
  for (const f of files) {
    if (!f?.content) continue;
    let parsed: unknown;
    try {
      parsed = parseLegacyImportText(f.name, f.content);
    } catch {
      return errorResponse(
        `${f.name ?? "(unnamed)"} を JSON/CSV/TSV として解析できませんでした。`,
        400,
      );
    }
    const { eventInputs, videoInputs } = splitLegacyPayload(parsed);
    allEvents.push(...eventInputs);
    allVideos.push(...videoInputs);
  }

  if (allEvents.length === 0 && allVideos.length === 0) {
    return errorResponse(
      "認識できる events / videos が含まれていません。",
      400,
      ["empty"],
    );
  }

  const importMode = normalizeImportMode(body.strategy?.importMode);
  const strategy = normalizeStrategy(body.strategy?.strategy);
  const enqueueStaticRebuild = body.strategy?.enqueueStaticRebuild !== false;
  const action = body.action ?? "analyze";
  const anchorNow =
    action === "apply" &&
    typeof body.anchorNow === "number" &&
    Number.isFinite(body.anchorNow)
      ? Math.floor(body.anchorNow)
      : Math.floor(Date.now() / 1000);

  const normalizedEvents = allEvents.map((e) =>
    normalizeEventInfo(e as Parameters<typeof normalizeEventInfo>[0], {
      importMode,
      now: anchorNow,
    }),
  );
  const normalizedVideos = allVideos.map((v) =>
    normalizeLegacyVideo(v as Parameters<typeof normalizeLegacyVideo>[0]),
  );

  const plan = buildLegacyImportPlan(normalizedEvents, normalizedVideos, anchorNow, {
    importMode,
  });

  // ハッシュ・トークン計算
  const fileHashInput = files.map((f) => ({
    name: f.name ?? "",
    content: f.content ?? "",
    size: (f.content ?? "").length,
  }));
  const [fileHash, planHash] = await Promise.all([
    hashFiles(fileHashInput),
    stableSha256(plan),
  ]);
  const previewToken = await buildPreviewToken({
    fileHash,
    strategy,
    importMode,
    userId: u.id,
    anchorNow,
    featureFlagEnabled: true,
  });

  if (action === "analyze") {
    const db = getDatabase();
    if (!db) {
      return errorResponse("D1 データベースに接続できません。", 503);
    }
    const dryRun = await buildDryRunResult(db, plan, strategy);
    return NextResponse.json({
      ...dryRun,
      previewToken,
      anchorNow,
      plan: {
        events: plan.stats.events,
        videos: plan.stats.videos,
        xUsers: plan.stats.xUsers,
        warnings: plan.stats.warnings,
        errors: plan.stats.errors,
      },
    });
  }

  if (action === "apply") {
    if (
      !body.previewToken ||
      body.previewToken !== previewToken ||
      body.anchorNow !== anchorNow
    ) {
      return errorResponse(
        "反映前に現在のファイルと設定でドライランを実行してください。",
        409,
        ["preview-required"],
      );
    }

    const db = getDatabase();
    if (!db) {
      return errorResponse("D1 データベースに接続できません。", 503);
    }

    const batchId = generateId("lib");
    const result = await applyLegacyImportPlan(
      db,
      plan,
      {
        strategy,
        importMode,
        enqueueStaticRebuild,
        batchId,
        fileHash,
        planHash,
        fileNamesJson: JSON.stringify(files.map((f) => f.name ?? "")),
        fileCount: files.length,
      },
      u.id,
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  return errorResponse(`不明なアクション: ${action}`, 400);
}
