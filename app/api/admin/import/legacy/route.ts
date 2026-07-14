export const runtime = "edge";

import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { eventCustomQuestions, eventStaff, events, legacyImportBatches, slots, videoCustomAnswers, videoEvents, videoMembers, videoSoftwares, videoYoutubeMetadata, videos, xUsers } from "@/lib/db/schema";
import { getLegacyImportPreviewSecret, isLegacyImportToolEnabled } from "@/lib/import/legacy/featureFlag";
import { parseLegacyImportText } from "@/lib/import/legacy/parse";
import { splitLegacyPayload } from "@/lib/import/legacy/payload";
import { normalizeEventInfo, normalizeLegacyVideo } from "@/lib/import/legacy/normalize";
import { assertLegacyImportPlanLimits, buildLegacyImportPlan } from "@/lib/import/legacy/plan";
import { buildDryRunResult } from "@/lib/import/legacy/dryRun";
import { applyLegacyImportPlan, cleanupExpiredLegacyImportBatches } from "@/lib/import/legacy/apply";
import { buildPreviewToken, LEGACY_IMPORT_PREVIEW_TTL_SECONDS, verifyPreviewToken } from "@/lib/import/legacy/previewToken";
import { hashFiles, stableSha256 } from "@/lib/import/legacy/hash";
import { generateId } from "@/lib/utils/id";
import { MAX_IMPORT_FILES, MAX_IMPORT_TOTAL_BYTES, MAX_CANONICAL_PLAN_BYTES, MAX_IN_CLAUSE, LEGACY_IMPORT_LEASE_SECONDS, PARSER_VERSION, SCHEMA_VERSION } from "@/lib/import/legacy/constants";
import type { ImportMode, ImportStrategy, LegacyImportPlan } from "@/lib/import/legacy/types";

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

type TargetVersion = { id: string; updatedAt: number | null };
type PreviewTargetVersions = {
  events: TargetVersion[];
  videos: TargetVersion[];
  relationHash: string;
};
type StoredPreviewStrategy = {
  previewVersion: 1;
  nonce: string;
  expiresAt: number;
  anchorNow: number;
  strategy: ImportStrategy;
  importMode: ImportMode;
  enqueueStaticRebuild: boolean;
  parserVersion: string;
  schemaVersion: string;
  targetVersions: PreviewTargetVersions;
};

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
  if (raw === "skip") return "skip_existing";
  return "skip_existing";
}

function chunked<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function captureTargetVersions(
  db: DB,
  plan: LegacyImportPlan,
): Promise<PreviewTargetVersions> {
  const eventIds = [...new Set(plan.events.map((event) => event.id))].sort();
  const videoIds = [...new Set(plan.videos.map((video) => video.id))].sort();
  const xUserIds = [...new Set(plan.xUsers.map((xUser) => xUser.id.toLowerCase()))].sort();
  const eventVersions = new Map<string, number>();
  const videoVersions = new Map<string, number>();
  const relations: Record<string, unknown[]> = {
    event_custom_questions: [],
    event_staff: [],
    event_slots: [],
    video_custom_answers: [],
    video_events: [],
    video_members: [],
    video_slots: [],
    video_softwares: [],
    video_youtube_metadata: [],
    x_users: [],
  };

  for (const ids of chunked(eventIds, MAX_IN_CLAUSE)) {
    const rows = await db
        .select({ id: events.id, updatedAt: events.updated_at })
        .from(events)
        .where(inArray(events.id, ids));
    const staffRows = await db.select().from(eventStaff).where(inArray(eventStaff.event_id, ids));
    const questionRows = await db.select().from(eventCustomQuestions).where(inArray(eventCustomQuestions.event_id, ids));
    const slotRows = await db.select().from(slots).where(inArray(slots.event_id, ids));
    for (const row of rows) eventVersions.set(row.id, row.updatedAt);
    relations.event_staff.push(...staffRows);
    relations.event_custom_questions.push(...questionRows);
    relations.event_slots.push(...slotRows);
  }
  for (const ids of chunked(videoIds, MAX_IN_CLAUSE)) {
    const rows = await db
          .select({ id: videos.id, updatedAt: videos.updated_at })
          .from(videos)
          .where(inArray(videos.id, ids));
    const memberRows = await db.select().from(videoMembers).where(inArray(videoMembers.video_id, ids));
    const eventRows = await db.select().from(videoEvents).where(inArray(videoEvents.video_id, ids));
    const answerRows = await db.select().from(videoCustomAnswers).where(inArray(videoCustomAnswers.video_id, ids));
    const softwareRows = await db.select().from(videoSoftwares).where(inArray(videoSoftwares.video_id, ids));
    const metadataRows = await db.select().from(videoYoutubeMetadata).where(inArray(videoYoutubeMetadata.video_id, ids));
    const slotRows = await db.select().from(slots).where(inArray(slots.video_id, ids));
    for (const row of rows) videoVersions.set(row.id, row.updatedAt);
    relations.video_members.push(...memberRows);
    relations.video_events.push(...eventRows);
    relations.video_custom_answers.push(...answerRows);
    relations.video_softwares.push(...softwareRows);
    relations.video_youtube_metadata.push(...metadataRows);
    relations.video_slots.push(...slotRows);
  }
  for (const ids of chunked(xUserIds, MAX_IN_CLAUSE)) {
    const rows = await db
      .select()
      .from(xUsers)
      .where(inArray(sql<string>`lower(${xUsers.id})`, ids));
    relations.x_users.push(...rows);
  }
  const relationHash = await stableSha256(
    Object.fromEntries(
      Object.entries(relations).map(([table, rows]) => [
        table,
        [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      ]),
    ),
  );

  return {
    events: eventIds.map((id) => ({ id, updatedAt: eventVersions.get(id) ?? null })),
    videos: videoIds.map((id) => ({ id, updatedAt: videoVersions.get(id) ?? null })),
    relationHash,
  };
}

function isTargetVersion(value: unknown): value is TargetVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (row.updatedAt === null || (typeof row.updatedAt === "number" && Number.isSafeInteger(row.updatedAt)))
  );
}

function parseStoredPreviewStrategy(value: string): StoredPreviewStrategy | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const targetVersions = parsed.targetVersions as Record<string, unknown> | undefined;
    if (
      parsed.previewVersion !== 1 ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      typeof parsed.anchorNow !== "number" ||
      !Number.isSafeInteger(parsed.anchorNow) ||
      (parsed.strategy !== "create_only" && parsed.strategy !== "replace_imported" && parsed.strategy !== "skip_existing") ||
      (parsed.importMode !== "archive" && parsed.importMode !== "preserve" && parsed.importMode !== "active_event" && parsed.importMode !== "draft") ||
      typeof parsed.enqueueStaticRebuild !== "boolean" ||
      parsed.parserVersion !== PARSER_VERSION ||
      parsed.schemaVersion !== SCHEMA_VERSION ||
      !targetVersions ||
      !Array.isArray(targetVersions.events) ||
      !Array.isArray(targetVersions.videos) ||
      typeof targetVersions.relationHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(targetVersions.relationHash) ||
      !targetVersions.events.every(isTargetVersion) ||
      !targetVersions.videos.every(isTargetVersion)
    ) {
      return null;
    }
    return parsed as unknown as StoredPreviewStrategy;
  } catch {
    return null;
  }
}

async function targetVersionsStillMatch(
  db: DB,
  plan: LegacyImportPlan,
  expected: PreviewTargetVersions,
): Promise<boolean> {
  const current = await captureTargetVersions(db, plan);
  return JSON.stringify(current) === JSON.stringify(expected);
}

async function markPreviewFailed(
  db: DB,
  batchId: string,
  leaseToken: string,
  message: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(legacyImportBatches)
    .set({
      status: "failed",
      failed_at: now,
      error_count: 1,
      error_summary: message.slice(0, 1000),
      lease_token: null,
      lease_expires_at: null,
      consumed_at: now,
    })
    .where(and(
      eq(legacyImportBatches.id, batchId),
      eq(legacyImportBatches.status, "applying"),
      eq(legacyImportBatches.lease_token, leaseToken),
    )!);
}

export async function POST(req: Request): Promise<Response> {
  const previewSecret = getLegacyImportPreviewSecret();
  if (!isLegacyImportToolEnabled() || !previewSecret) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "旧データ移行ツールは現在無効です。ENABLE_LEGACY_IMPORT_TOOL=true と 32 文字以上の LEGACY_IMPORT_PREVIEW_SECRET を設定してください。",
      },
      { status: 403 },
    );
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "admin") return errorResponse("forbidden", 403);

  let body: JsonRequest;
  try {
    body = (await req.json()) as JsonRequest;
  } catch {
    return errorResponse("リクエスト JSON が不正です。", 400);
  }

  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) return errorResponse("files が必要です。", 400);
  if (files.length > MAX_IMPORT_FILES) {
    return errorResponse(`ファイル数が上限 (${MAX_IMPORT_FILES}) を超えています。`, 413);
  }
  let totalChars = 0;
  for (const file of files) {
    totalChars += (file.content ?? "").length;
    if (totalChars > MAX_IMPORT_TOTAL_BYTES * 2) {
      return errorResponse("ファイルの合計サイズが上限を超えています。", 413, ["size-limit"]);
    }
  }

  const action = body.action ?? "analyze";
  const importMode = normalizeImportMode(body.strategy?.importMode);
  const strategy = normalizeStrategy(body.strategy?.strategy);
  const enqueueStaticRebuild = body.strategy?.enqueueStaticRebuild !== false;
  const anchorNow =
    action === "apply" &&
    typeof body.anchorNow === "number" &&
    Number.isFinite(body.anchorNow)
      ? Math.floor(body.anchorNow)
      : Math.floor(Date.now() / 1000);

  const eventInputs: unknown[] = [];
  const videoInputs: unknown[] = [];
  for (const file of files) {
    if (!file?.content) continue;
    try {
      const parsed = parseLegacyImportText(file.name, file.content);
      const split = splitLegacyPayload(parsed);
      eventInputs.push(...split.eventInputs);
      videoInputs.push(...split.videoInputs);
    } catch {
      return errorResponse(`${file.name ?? "(unnamed)"} を JSON/CSV/TSV として解析できませんでした。`, 400);
    }
  }
  if (eventInputs.length === 0 && videoInputs.length === 0) {
    return errorResponse("入力できる events / videos が含まれていません。", 400, ["empty"]);
  }

  const normalizedEvents = eventInputs.map((input) =>
    normalizeEventInfo(input as Parameters<typeof normalizeEventInfo>[0], {
      importMode,
      now: anchorNow,
    }),
  );
  const normalizedVideos = videoInputs.map((input) =>
    normalizeLegacyVideo(input as Parameters<typeof normalizeLegacyVideo>[0]),
  );
  const plan = buildLegacyImportPlan(normalizedEvents, normalizedVideos, anchorNow, {
    importMode,
  });
  try {
    assertLegacyImportPlanLimits(plan, strategy, action);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "legacy import plan limit exceeded",
      413,
      ["plan-limit"],
    );
  }
  const fileHashInput = files.map((file) => ({
    name: file.name ?? "",
    content: file.content ?? "",
    size: (file.content ?? "").length,
  }));
  const [fileHash, planHash] = await Promise.all([
    hashFiles(fileHashInput),
    stableSha256(plan),
  ]);

  const db = getDatabase();
  if (!db) return errorResponse("D1 データベースに接続できません。", 503);

  await cleanupExpiredLegacyImportBatches(db);

  if (action === "analyze") {
    const dryRun = await buildDryRunResult(db, plan, strategy);
    if (!dryRun.ok) {
      return NextResponse.json({
        ...dryRun,
        previewToken: null,
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

    const now = Math.floor(Date.now() / 1000);
    const batchId = generateId("lib");
    const nonce = generateId("lip");
    const expiresAt = now + LEGACY_IMPORT_PREVIEW_TTL_SECONDS;
    const canonicalPlanJson = JSON.stringify(plan);
    if (new TextEncoder().encode(canonicalPlanJson).length > MAX_CANONICAL_PLAN_BYTES) {
      return errorResponse(
        "canonical import plan が許可サイズを超えています。対象を分割してください。",
        413,
        ["canonical-plan-limit"],
      );
    }
    const targetVersions = await captureTargetVersions(db, plan);
    const storedStrategy: StoredPreviewStrategy = {
      previewVersion: 1,
      nonce,
      expiresAt,
      anchorNow,
      strategy,
      importMode,
      enqueueStaticRebuild,
      parserVersion: PARSER_VERSION,
      schemaVersion: SCHEMA_VERSION,
      targetVersions,
    };
    await db.insert(legacyImportBatches).values({
      id: batchId,
      status: "previewed",
      file_count: files.length,
      file_names_json: JSON.stringify(files.map((file) => file.name ?? "")),
      file_hash: fileHash,
      plan_hash: planHash,
      parser_version: PARSER_VERSION,
      schema_version: SCHEMA_VERSION,
      strategy_json: JSON.stringify(storedStrategy),
      counts_json: JSON.stringify(dryRun.counts),
      warning_count: plan.warnings.length,
      error_count: 0,
      executed_by_user_id: user.id,
      created_at: now,
      applied_at: null,
      failed_at: null,
      error_summary: null,
      canonical_plan_json: canonicalPlanJson,
      preview_expires_at: expiresAt,
      lease_token: null,
      lease_expires_at: null,
      consumed_at: null,
    });
    const previewToken = await buildPreviewToken(
      {
        batchId,
        nonce,
        fileHash,
        planHash,
        strategy,
        importMode,
        enqueueStaticRebuild,
        userId: user.id,
        anchorNow,
        expiresAt,
      },
      previewSecret,
    );
    return NextResponse.json({
      ...dryRun,
      batchId,
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

  if (action !== "apply") return errorResponse(`不正なアクション: ${action}`, 400);
  if (plan.errors.length > 0) {
    return errorResponse(
      "検証エラーを含む import plan は適用できません。",
      422,
      plan.errors.map((error) => `${error.source}: ${error.message}`),
    );
  }
  if (!body.previewToken) return errorResponse("事前分析の preview token が必要です。", 409, ["preview-required"]);

  const claims = await verifyPreviewToken(body.previewToken, previewSecret);
  const now = Math.floor(Date.now() / 1000);
  if (
    !claims ||
    claims.expiresAt < now ||
    claims.userId !== user.id ||
    claims.fileHash !== fileHash ||
    claims.planHash !== planHash ||
    claims.strategy !== strategy ||
    claims.importMode !== importMode ||
    claims.enqueueStaticRebuild !== enqueueStaticRebuild ||
    claims.anchorNow !== anchorNow
  ) {
    return errorResponse("preview token が無効、期限切れ、または現在の入力と一致しません。", 409, ["preview-invalid"]);
  }

  const preview = (
    await db
      .select()
      .from(legacyImportBatches)
      .where(eq(legacyImportBatches.id, claims.batchId))
      .limit(1)
  )[0];
  const storedStrategy = preview ? parseStoredPreviewStrategy(preview.strategy_json) : null;
  if (
    !preview ||
    !storedStrategy ||
    preview.status !== "previewed" ||
    preview.executed_by_user_id !== user.id ||
    preview.file_hash !== fileHash ||
    preview.plan_hash !== planHash ||
    preview.parser_version !== PARSER_VERSION ||
    preview.schema_version !== SCHEMA_VERSION ||
    preview.preview_expires_at !== claims.expiresAt ||
    !preview.canonical_plan_json ||
    preview.lease_token !== null ||
    preview.consumed_at !== null ||
    storedStrategy.nonce !== claims.nonce ||
    storedStrategy.expiresAt !== claims.expiresAt ||
    storedStrategy.anchorNow !== anchorNow ||
    storedStrategy.strategy !== strategy ||
    storedStrategy.importMode !== importMode ||
    storedStrategy.enqueueStaticRebuild !== enqueueStaticRebuild
  ) {
    return errorResponse("preview record が存在しないか、既に使用済みです。", 409, ["preview-consumed"]);
  }
  if (!(await targetVersionsStillMatch(db, plan, storedStrategy.targetVersions))) {
    return errorResponse("分析後に対象データが変更されたため、再分析が必要です。", 409, ["preview-stale"]);
  }

  const leaseToken = generateId("lil");
  const leaseExpiresAt = now + LEGACY_IMPORT_LEASE_SECONDS;
  try {
    await db.batch([
      db.run(sql`
        UPDATE legacy_import_batches
        SET status = 'applying',
            error_summary = NULL,
            failed_at = NULL,
            lease_token = ${leaseToken},
            lease_expires_at = ${leaseExpiresAt}
        WHERE id = ${claims.batchId}
          AND status = 'previewed'
          AND preview_expires_at = ${claims.expiresAt}
          AND preview_expires_at >= ${now}
          AND canonical_plan_json IS NOT NULL
          AND lease_token IS NULL
          AND consumed_at IS NULL
      `),
      db.run(sql`
        SELECT CASE
          WHEN changes() = 1 THEN 1
          ELSE json_extract('not-valid-json', '$')
        END
      `),
    ]);
  } catch {
    return errorResponse("preview record は既に使用済みです。", 409, ["preview-consumed"]);
  }

  try {
    const result = await applyLegacyImportPlan(
      db,
      plan,
      {
        strategy,
        importMode,
        enqueueStaticRebuild,
        batchId: claims.batchId,
        fileHash,
        planHash,
        leaseToken,
        fileNamesJson: JSON.stringify(files.map((file) => file.name ?? "")),
        fileCount: files.length,
      },
      user.id,
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "legacy import apply に失敗しました。";
    try {
      await markPreviewFailed(db, claims.batchId, leaseToken, message);
    } catch {
      // apply 側の content mutation は失敗している。失敗記録不能時も再試行を許可しない。
    }
    return errorResponse("legacy import の適用に失敗しました。", 500, [message]);
  }
}
