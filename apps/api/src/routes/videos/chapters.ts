/**
 * MIG-0603 U02b: SA-012..015 chapter writes on Hono.
 * CURRENT: src/lib/actions/chapter.ts (createChapter / updateChapter /
 * deleteChapter / createChaptersBulk). Mounted behind origin -> session ->
 * writeGuard (any authenticated role, TOS, CostGuard "chapter_comment", then
 * an approved active X) exactly like CURRENT writeGuard({ requireApprovedActiveXId,
 * feature: "chapter_comment" }); see videoWriteStack in ./index.ts.
 *
 * Result bodies keep the CURRENT ChapterActionResult shape; HTTP status is
 * added: validation 400 / video or chapter not found 404 / not allowed 403 /
 * stale active X snapshot 409 / body too large 413 / atomic mutation failure
 * (CAS miss included, CURRENT generic message) 500.
 *
 * D1 budget (ZERO_1102 S3, guard included): guard user read + CostGuard settings
 * (both reused by the audit) + 1 chapter/video read (video_events ids and the
 * approved X ids' event_staff rows ride along as subqueries) = 3 reads, then 1 batch. The post-commit Queue wake of CURRENT
 * (staticRebuildWakeSource "web") is not sent: see the work item, D-0603-1.
 */
import {
  ChapterBulkBodySchema,
  ChapterWriteBodySchema,
  MAX_CHAPTER_BULK_ROWS,
  type BulkChapterActionResult,
  type ChapterActionResult,
} from "@flamenode/contracts";
import { validateChapterTime } from "@flamenode/domain/video";
import { validateActiveXSnapshot } from "@flamenode/domain/xid";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import {
  generateId,
  MAX_SINGLE_ROW_LIMIT,
  mutateWithAudit,
  type SqlStatement,
} from "../../audit/mutateWithAudit.ts";
import { buildStaticRebuildQueueStatement } from "../../audit/staticRebuildQueue.ts";
import { expectedRowCondition } from "../admin/apiEndpoints.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";
import {
  accessFactsColumnsSql,
  approvedXIdsJson,
  canAdministerChapters,
  parseAccessFacts,
  type AccessFacts,
} from "./chapterAccess.ts";
import { parseChapterBulkCsv } from "./chapterCsv.ts";

const CHAPTER_FAILURE_MESSAGE =
  "チャプターの保存に失敗しました。画面を更新してもう一度お試しください。";
const SELECT_ACTIVE_X_MESSAGE = "X ID を選択してから操作してください。";
const VIDEO_NOT_FOUND_MESSAGE = "動画が見つかりません。";
const CHAPTER_NOT_POSTABLE_MESSAGE = "この動画にはチャプターコメントを投稿できません。";
const INVALID_INPUT_MESSAGE = "入力エラー";

// Drizzle select() column order of packages/db schema `video_chapters`; the
// order is part of the audit before/after JSON bytes (pinned by test).
export const CHAPTER_COLUMNS = [
  "id", "video_id", "x_user_id", "chapter_time", "chapter_label", "note",
  "visibility", "created_at", "updated_at",
] as const;

type ChapterRow = Record<(typeof CHAPTER_COLUMNS)[number], unknown> & {
  id: string;
  video_id: string;
  x_user_id: string | null;
};

type VideoFacts = {
  id: string;
  primary_event_id: string | null;
  visibility_status: string | null;
  durationSeconds: number | null;
  access: AccessFacts;
};

type ChapterContext = Context<AppEnv>;
type FailStatus = 400 | 403 | 404 | 409 | 413 | 500;

function fail(c: ChapterContext, status: FailStatus, message: string, extra?: object) {
  const body: ChapterActionResult = { ok: false, message, ...extra };
  return c.json(body, status);
}

const durationOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/** CURRENT loadVideoDurationSeconds is folded into the video read (one statement). */
async function loadVideo(
  db: D1Database,
  videoId: string,
  approvedJson: string,
): Promise<VideoFacts | null> {
  const row = await db
    .prepare(
      `SELECT v."id" AS id, v."primary_event_id" AS primary_event_id,
              v."visibility_status" AS visibility_status,
              (SELECT m."duration_seconds" FROM "video_youtube_metadata" m
                WHERE m."video_id" = v."id" LIMIT ${MAX_SINGLE_ROW_LIMIT}) AS duration_seconds,
              ${accessFactsColumnsSql('v."id"', 'v."primary_event_id"')}
         FROM "videos" v WHERE v."id" = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    )
    .bind(approvedJson, videoId)
    .first<{
      id: string;
      primary_event_id: string | null;
      visibility_status: string | null;
      duration_seconds: unknown;
      ve_json: unknown;
      staff_json: unknown;
    }>();
  return row
    ? {
        id: row.id,
        primary_event_id: row.primary_event_id,
        visibility_status: row.visibility_status,
        durationSeconds: durationOrNull(row.duration_seconds),
        access: parseAccessFacts(row.ve_json, row.staff_json),
      }
    : null;
}

/** The chapter and its video (+ duration) in one statement; `video` is null when the video row is gone. */
async function loadChapter(
  db: D1Database,
  chapterId: string,
  approvedJson: string,
): Promise<{ chapter: ChapterRow; video: VideoFacts | null } | null> {
  const row = await db
    .prepare(
      `SELECT ${CHAPTER_COLUMNS.map((column) => `c."${column}" AS "${column}"`).join(", ")},
              v."id" AS v_id, v."primary_event_id" AS v_primary_event_id,
              v."visibility_status" AS v_visibility_status,
              (SELECT m."duration_seconds" FROM "video_youtube_metadata" m
                WHERE m."video_id" = c."video_id" LIMIT ${MAX_SINGLE_ROW_LIMIT}) AS v_duration_seconds,
              ${accessFactsColumnsSql('c."video_id"', 'v."primary_event_id"')}
         FROM "video_chapters" c LEFT JOIN "videos" v ON v."id" = c."video_id"
        WHERE c."id" = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    )
    .bind(approvedJson, chapterId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const chapter = {} as Record<string, unknown>;
  for (const column of CHAPTER_COLUMNS) chapter[column] = row[column];
  return {
    chapter: chapter as ChapterRow,
    video:
      typeof row.v_id === "string"
        ? {
            id: row.v_id,
            primary_event_id: (row.v_primary_event_id as string | null) ?? null,
            visibility_status: (row.v_visibility_status as string | null) ?? null,
            durationSeconds: durationOrNull(row.v_duration_seconds),
            access: parseAccessFacts(row.ve_json, row.staff_json),
          }
        : null,
  };
}

/** CURRENT canManageChapter: own chapter (active X) or video.chapter_admin in admin/event mode. */
function canManageChapter(
  c: ChapterContext,
  chapter: ChapterRow,
  video: VideoFacts,
  activeXId: string,
): boolean {
  if (chapter.x_user_id === activeXId) return true;
  return canAdministerChapters(
    c.get("user")!.role,
    c.get("activeX").approvedXIds,
    video,
  );
}

/** Update / delete preflight: chapter -> video -> canManageChapter (CURRENT order). */
async function loadManaged(
  c: ChapterContext,
  chapterId: string,
  activeXId: string,
  missing: () => Response,
  deniedMessage: string,
): Promise<{ chapter: ChapterRow; video: VideoFacts } | { response: Response }> {
  try {
    const approvedJson = approvedXIdsJson(c.get("user")!.role, c.get("activeX").approvedXIds);
    const loaded = await loadChapter(c.env.DB, chapterId, approvedJson);
    if (!loaded) return { response: missing() };
    if (!loaded.video) return { response: fail(c, 404, VIDEO_NOT_FOUND_MESSAGE) };
    if (!canManageChapter(c, loaded.chapter, loaded.video, activeXId)) {
      return { response: fail(c, 403, deniedMessage) };
    }
    return { chapter: loaded.chapter, video: loaded.video };
  } catch (error) {
    console.error("[chapter] read failed", error);
    return { response: fail(c, 500, CHAPTER_FAILURE_MESSAGE) };
  }
}

type JsonInput =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };

async function readJson(c: ChapterContext): Promise<JsonInput> {
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") {
    return { ok: false, response: fail(c, 413, BODY_TOO_LARGE_MESSAGE) };
  }
  if (read.kind === "invalid") {
    return { ok: false, response: fail(c, 400, INVALID_INPUT_MESSAGE) };
  }
  return { ok: true, value: read.value };
}

/** CURRENT validateActiveXSnapshot on the submitted `active_x_snapshot` (create / bulk only). */
function snapshotDeny(c: ChapterContext, raw: Record<string, unknown>, activeXId: string) {
  const submitted = raw.active_x_snapshot;
  const check = validateActiveXSnapshot({
    submittedSnapshot: submitted == null ? "" : String(submitted),
    currentActiveXId: activeXId,
  });
  return check.ok ? null : fail(c, 409, check.message);
}

function queueFor(videoId: string, reason: string, userId: string) {
  return buildStaticRebuildQueueStatement({
    targetType: "video",
    targetId: videoId,
    reason,
    requestedByUserId: userId,
  });
}

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

// SA-012 createChapter: POST /api/videos/:videoId/chapters
function createChapterHandler() {
  return async (c: ChapterContext) => {
    const user = c.get("user")!;
    const activeX = c.get("activeX").activeXId;
    if (!activeX) return fail(c, 403, SELECT_ACTIVE_X_MESSAGE);
    const input = await readJson(c);
    if (!input.ok) return input.response;
    const snapshot = snapshotDeny(c, input.value, activeX);
    if (snapshot) return snapshot;
    const parsed = ChapterWriteBodySchema.safeParse(input.value);
    if (!parsed.success) {
      return fail(c, 400, parsed.error.issues[0]?.message ?? INVALID_INPUT_MESSAGE);
    }
    const data = parsed.data;
    const videoId = (c.req.param("videoId") ?? "").trim();
    const db = c.env.DB;

    let video: VideoFacts | null;
    try {
      video = await loadVideo(db, videoId, "[]");
    } catch (error) {
      console.error("[chapter] video read failed", error);
      return fail(c, 500, CHAPTER_FAILURE_MESSAGE);
    }
    if (!video) return fail(c, 404, VIDEO_NOT_FOUND_MESSAGE);
    if (video.visibility_status !== "public") {
      return fail(c, 403, CHAPTER_NOT_POSTABLE_MESSAGE);
    }
    const time = validateChapterTime(data.chapter_time, {
      videoDurationSeconds: video.durationSeconds,
    });
    if (!time.ok) return fail(c, 400, time.message);

    const id = generateId("ch");
    const now = Math.floor(Date.now() / 1000);
    const after = {
      id,
      video_id: videoId,
      x_user_id: activeX,
      chapter_time: time.seconds,
      chapter_label: data.chapter_label,
      note: data.note ?? null,
      visibility: data.visibility,
      created_at: now,
      updated_at: now,
    };
    try {
      const queue = queueFor(videoId, "chapter_create", user.id);
      await mutateWithAudit(db, {
        mutationStatements: [
          {
            sql: `
    INSERT INTO video_chapters (
      id, video_id, x_user_id, chapter_time, chapter_label, note,
      visibility, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
            params: [
              after.id, after.video_id, after.x_user_id, after.chapter_time,
              after.chapter_label, after.note, after.visibility,
              after.created_at, after.updated_at,
            ],
          },
          queue.statement,
        ],
        expectedMutationChanges: [1, queue.expectedChanges],
        preloaded: auditPreloaded(c),
        audits: [
          {
            table_name: "video_chapters",
            target_id: id,
            operation: "CREATE",
            before: null,
            after: { ...after },
            actor_user_id: user.id,
            retention_class: "normal",
          },
        ],
      });
    } catch (error) {
      console.error("[chapter] atomic mutation failed", error);
      return fail(c, 500, CHAPTER_FAILURE_MESSAGE);
    }
    const body: ChapterActionResult = { ok: true, chapterId: id, pendingPublicReflection: true };
    return c.json(body, 200);
  };
}

// SA-013 updateChapter: PUT /api/videos/chapters/:chapterId
function updateChapterHandler() {
  return async (c: ChapterContext) => {
    const user = c.get("user")!;
    const activeX = c.get("activeX").activeXId;
    if (!activeX) return fail(c, 403, SELECT_ACTIVE_X_MESSAGE);
    const input = await readJson(c);
    if (!input.ok) return input.response;
    const parsed = ChapterWriteBodySchema.safeParse(input.value);
    if (!parsed.success) {
      return fail(c, 400, parsed.error.issues[0]?.message ?? INVALID_INPUT_MESSAGE);
    }
    const data = parsed.data;
    const chapterId = (c.req.param("chapterId") ?? "").trim();
    const db = c.env.DB;

    const loaded = await loadManaged(
      c,
      chapterId,
      activeX,
      () => fail(c, 404, "チャプターが見つかりません。"),
      "このチャプターを更新する権限がありません。",
    );
    if ("response" in loaded) return loaded.response;
    const existing = loaded.chapter;
    const time = validateChapterTime(data.chapter_time, {
      videoDurationSeconds: loaded.video.durationSeconds,
    });
    if (!time.ok) return fail(c, 400, time.message);

    const now = Math.floor(Date.now() / 1000);
    const after = {
      ...existing,
      chapter_time: time.seconds,
      chapter_label: data.chapter_label,
      note: data.note ?? null,
      visibility: data.visibility,
      updated_at: now,
    };
    try {
      const queue = queueFor(existing.video_id, "chapter_update", user.id);
      const expected = expectedRowCondition({ ...existing });
      await mutateWithAudit(db, {
        mutationStatements: [
          {
            sql: `UPDATE "video_chapters" SET "chapter_time" = ?, "chapter_label" = ?, "note" = ?,
                  "visibility" = ?, "updated_at" = ? WHERE ${expected.sql}`,
            params: [
              after.chapter_time, after.chapter_label, after.note,
              after.visibility, after.updated_at, ...expected.params,
            ],
          },
          queue.statement,
        ],
        expectedMutationChanges: [1, queue.expectedChanges],
        preloaded: auditPreloaded(c),
        audits: [
          {
            table_name: "video_chapters",
            target_id: existing.id,
            operation: "UPDATE",
            before: { ...existing },
            after: { ...after },
            actor_user_id: user.id,
            retention_class: "normal",
          },
        ],
      });
    } catch (error) {
      console.error("[chapter] atomic mutation failed", error);
      return fail(c, 500, CHAPTER_FAILURE_MESSAGE);
    }
    const body: ChapterActionResult = {
      ok: true,
      chapterId: existing.id,
      message: "チャプターを更新しました。",
      pendingPublicReflection: true,
    };
    return c.json(body, 200);
  };
}

// SA-014 deleteChapter: DELETE /api/videos/chapters/:chapterId
function deleteChapterHandler() {
  return async (c: ChapterContext) => {
    const user = c.get("user")!;
    const activeX = c.get("activeX").activeXId;
    if (!activeX) return fail(c, 403, SELECT_ACTIVE_X_MESSAGE);
    const chapterId = (c.req.param("chapterId") ?? "").trim();
    if (!chapterId) return fail(c, 400, INVALID_INPUT_MESSAGE);
    const db = c.env.DB;

    const loaded = await loadManaged(
      c,
      chapterId,
      activeX,
      () => {
        // CURRENT: an already deleted chapter is a successful (idempotent) delete.
        const done: ChapterActionResult = { ok: true, chapterId, message: "既に削除されています。" };
        return c.json(done, 200);
      },
      "このチャプターを削除する権限がありません。",
    );
    if ("response" in loaded) return loaded.response;
    const existing = loaded.chapter;
    try {
      const queue = queueFor(existing.video_id, "chapter_delete", user.id);
      const expected = expectedRowCondition({ ...existing });
      await mutateWithAudit(db, {
        mutationStatements: [
          { sql: `DELETE FROM "video_chapters" WHERE ${expected.sql}`, params: expected.params },
          queue.statement,
        ],
        expectedMutationChanges: [1, queue.expectedChanges],
        preloaded: auditPreloaded(c),
        audits: [
          {
            table_name: "video_chapters",
            target_id: existing.id,
            operation: "DELETE",
            before: { ...existing },
            after: null,
            actor_user_id: user.id,
            retention_class: "normal",
          },
        ],
      });
    } catch (error) {
      console.error("[chapter] atomic mutation failed", error);
      return fail(c, 500, CHAPTER_FAILURE_MESSAGE);
    }
    const body: ChapterActionResult = {
      ok: true,
      chapterId: existing.id,
      message: "チャプターを削除しました。",
      pendingPublicReflection: true,
    };
    return c.json(body, 200);
  };
}

type BulkRow = {
  id: string;
  chapter_time: number;
  chapter_label: string;
  note: string | null;
  visibility: "public" | "private";
};

// SA-015 createChaptersBulk: POST /api/videos/:videoId/chapters/bulk
function bulkChaptersHandler() {
  return async (c: ChapterContext) => {
    const user = c.get("user")!;
    const activeX = c.get("activeX").activeXId;
    const bulkFail = (status: FailStatus, message: string, extra?: Partial<BulkChapterActionResult>) =>
      fail(c, status, message, extra);
    if (!activeX) return bulkFail(403, SELECT_ACTIVE_X_MESSAGE);
    const input = await readJson(c);
    if (!input.ok) return input.response;
    const snapshot = snapshotDeny(c, input.value, activeX);
    if (snapshot) return snapshot;
    const parsed = ChapterBulkBodySchema.safeParse(input.value);
    if (!parsed.success) {
      return bulkFail(400, parsed.error.issues[0]?.message ?? INVALID_INPUT_MESSAGE);
    }
    const videoId = (c.req.param("videoId") ?? "").trim();
    const db = c.env.DB;

    let video: VideoFacts | null;
    try {
      video = await loadVideo(db, videoId, approvedXIdsJson(user.role, c.get("activeX").approvedXIds));
      if (!video) return bulkFail(404, VIDEO_NOT_FOUND_MESSAGE);
      // Operator chapters: admin / event sources only, never the normal owner mode.
      if (!canAdministerChapters(user.role, c.get("activeX").approvedXIds, video)) {
        return bulkFail(403, "この動画のチャプター一括登録権限がありません。");
      }
    } catch (error) {
      console.error("[chapter] read failed", error);
      return bulkFail(500, CHAPTER_FAILURE_MESSAGE);
    }
    if (video.visibility_status !== "public") {
      return bulkFail(403, CHAPTER_NOT_POSTABLE_MESSAGE);
    }

    const rowsRaw = parseChapterBulkCsv(parsed.data.csv);
    if (rowsRaw.length === 0) return bulkFail(400, "CSV にデータがありません。");
    if (rowsRaw.length > MAX_CHAPTER_BULK_ROWS) {
      return bulkFail(400, `CSVは一度に最大${MAX_CHAPTER_BULK_ROWS}行まで登録できます。`, {
        inserted: 0,
        skipped: rowsRaw.length,
        errors: [`データ行を${MAX_CHAPTER_BULK_ROWS}行以内に分割してください。`],
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const errors: string[] = [];
    let skipped = 0;
    const pendingRows: BulkRow[] = [];
    for (let i = 0; i < rowsRaw.length; i++) {
      const cols = rowsRaw[i]!;
      const rawTime = (cols[0] ?? "").trim();
      const rawLabel = (cols[1] ?? "").trim();
      const rawNote = (cols[2] ?? "").trim();
      const rawVisibility = (cols[3] ?? "").trim().toLowerCase();
      // Column 5 (member name / X id) is accepted for compatibility and ignored, as in CURRENT.

      if (!rawTime && !rawLabel) {
        skipped += 1;
        continue;
      }
      const timeResult = validateChapterTime(rawTime, {
        videoDurationSeconds: video.durationSeconds,
      });
      if (!timeResult.ok) {
        errors.push(`行 ${i + 1}: ${timeResult.message} ("${rawTime}")`);
        skipped += 1;
        continue;
      }
      if (rawLabel.length === 0 || rawLabel.length > 120) {
        errors.push(`行 ${i + 1}: ラベルが必須 (1〜120文字)`);
        skipped += 1;
        continue;
      }
      if (rawNote.length > 1000) {
        errors.push(`行 ${i + 1}: コメントが 1000 文字を超えています`);
        skipped += 1;
        continue;
      }
      if (rawVisibility && rawVisibility !== "public" && rawVisibility !== "private") {
        errors.push(`行${i + 1}: visibility は public または private を指定してください。`);
        skipped += 1;
        continue;
      }
      pendingRows.push({
        id: generateId("ch"),
        chapter_time: timeResult.seconds,
        chapter_label: rawLabel,
        note: rawNote || null,
        visibility: rawVisibility === "private" ? "private" : "public",
      });
    }
    const inserted = pendingRows.length;
    if (inserted === 0) {
      return bulkFail(400, "登録できる行がありませんでした。", { inserted, skipped, errors });
    }

    try {
      const queue = queueFor(videoId, "chapter_bulk_create", user.id);
      const insert: SqlStatement = {
        sql: `
        INSERT INTO video_chapters (
          id, video_id, x_user_id, chapter_time, chapter_label, note,
          visibility, created_at, updated_at
        ) VALUES ${pendingRows.map(() => `(${placeholders(9)})`).join(", ")}
      `,
        params: pendingRows.flatMap((row) => [
          row.id, videoId, activeX, row.chapter_time, row.chapter_label,
          row.note, row.visibility, now, now,
        ]),
      };
      await mutateWithAudit(db, {
        mutationStatements: [insert, queue.statement],
        expectedMutationChanges: [inserted, queue.expectedChanges],
        preloaded: auditPreloaded(c),
        audits: pendingRows.map((row) => ({
          table_name: "video_chapters" as const,
          target_id: row.id,
          operation: "CREATE" as const,
          before: null,
          after: {
            id: row.id, video_id: videoId, x_user_id: activeX,
            chapter_time: row.chapter_time, chapter_label: row.chapter_label,
            note: row.note, visibility: row.visibility, created_at: now, updated_at: now,
          },
          actor_user_id: user.id,
          retention_class: "normal" as const,
        })),
      });
    } catch (error) {
      console.error("[chapter] atomic mutation failed", error);
      return bulkFail(500, CHAPTER_FAILURE_MESSAGE);
    }
    const body: BulkChapterActionResult = {
      ok: true,
      message: `${inserted} 件追加 / ${skipped} 件スキップ`,
      inserted,
      skipped,
      errors,
      pendingPublicReflection: true,
    };
    return c.json(body, 200);
  };
}

/** `guard` is the whole write stack (no-store header, origin, session, writeGuard). */
export function createChapterRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post("/:videoId/chapters", guard, createChapterHandler());
  routes.post("/:videoId/chapters/bulk", guard, bulkChaptersHandler());
  routes.put("/chapters/:chapterId", guard, updateChapterHandler());
  routes.delete("/chapters/:chapterId", guard, deleteChapterHandler());
  return routes;
}
