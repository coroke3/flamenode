import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  resolveIdenticalJsonArtifactPut,
  staticArtifactContentHash,
  staticArtifactCustomMetadata,
  type ArtifactHashCache,
} from "./r2Dedup.ts";
import {
  enqueueComposerFollowUps,
  enqueuePerTargetComposerFollowUp,
} from "./followUpEnqueue.ts";
import { rebuildTarget } from "./rebuild.ts";
import { rebuildUsersIndexV2FromLegacyArtifact } from "./usersIndexV2Artifacts.ts";
import { rebuildPublicIconV2FromLegacyArtifact } from "./publicIconV2Artifacts.ts";
import {
  mutateVideoMaterializedSource,
  VIDEO_MATERIALIZED_SOURCE_MAX_ROWS,
  type VideoMaterializedRow,
} from "./videoMaterializedSource.ts";
import {
  staticR2CacheControl,
  STATIC_R2_MAX_AGE_SEC,
} from "../shared/staticR2CacheControl.ts";
import { cancelR2BodyBestEffort } from "../../src/lib/r2Body.ts";
import { COUNTABLE_PUBLIC_VIDEO_SQL } from "../../src/lib/publicData/countablePublicVideoSql.ts";
import {
  TOP_LATEST_OBJECT_KEY,
  TOP_RECOMMENDED_OBJECT_KEY,
  TOP_SECTIONS_SCHEMA_VERSION,
} from "../../src/lib/publicData/staticTopSectionsCore.ts";
import {
  RECOMMEND_CORE_OBJECT_KEY,
  RECOMMEND_CORE_SCHEMA_VERSION,
} from "../../src/lib/publicData/staticRecommendCore.ts";
import {
  EVENT_PLAYLIST_MAX_ITEMS,
  EVENT_PLAYLIST_MAX_OBJECT_BYTES,
  EVENT_PLAYLIST_SCHEMA_VERSION,
  eventPlaylistObjectKey,
} from "../../src/lib/publicData/staticEventPlaylistCore.ts";

export type OptimizedRebuildEnv = {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  artifactHashCache?: ArtifactHashCache;
  videoSourceRows?: readonly VideoMaterializedRow[];
};

const STATIC_ARTIFACT_SCHEMA_VERSION = 1;
const RANKING_POOL_MAX_ITEMS = 5000;
const STATIC_LIST_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
/** Legacy rebuild readers must never parse an unbounded R2 JSON object. */
export const LEGACY_REBUILD_R2_MAX_OBJECT_BYTES = 16 * 1024 * 1024;

const RANKING_TARGETS = [
  "list_recent",
  "list_popular",
  "top_recommended",
  "top_latest",
  "recommend_core",
] as const;
const RANKING_TARGET_SET = new Set<string>(RANKING_TARGETS);
const VIDEO_SOURCE_PROJECTION_TARGETS = [
  ...RANKING_TARGETS,
  "search_index",
  "random_video_pool",
] as const;
const VIDEO_SOURCE_PROJECTION_TARGET_SET = new Set<string>(
  VIDEO_SOURCE_PROJECTION_TARGETS,
);
// 滞留した重複世代で、1回の再構築が無制限にqueueを読み込まないようにする。
// 通常はtargetごとにactive行が1件だけなので、平常時の結果は変わらない。
const RANKING_PENDING_CAPTURE_LIMIT = 50;
const MATERIALIZED_VIDEO_DIRTY_TARGET_LIMIT = 250;

type RankingPoolRow = VideoMaterializedRow;

type PendingRankingQueueRow = {
  id: string;
  target_type: string;
  updated_at: number;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(
    signal.reason === undefined
      ? "optimized static rebuild aborted"
      : String(signal.reason),
  );
}

/**
 * `rebuild.ts` is a large compatibility surface. Keep it unchanged and wrap
 * only its R2 access here: oversized/corrupt static JSON becomes an ordinary
 * miss, while an abort immediately after GET releases the unread body before
 * propagating cancellation. Other R2 methods are rebound to the original
 * bucket so Cloudflare's internal receiver is preserved.
 */
function withBoundedAbortSafeR2(
  env: OptimizedRebuildEnv,
  signal?: AbortSignal,
): OptimizedRebuildEnv {
  const r2 = new Proxy(env.R2, {
    get(target, property) {
      if (property === "get") {
        return async (key: string, options?: R2GetOptions) => {
          throwIfAborted(signal);
          const object = await target.get(key, options);
          if (signal?.aborted) {
            await cancelR2BodyBestEffort(object);
            throwIfAborted(signal);
          }
          if (
            object &&
            typeof object.size === "number" &&
            (!Number.isSafeInteger(object.size) ||
              object.size < 0 ||
              object.size > LEGACY_REBUILD_R2_MAX_OBJECT_BYTES)
          ) {
            await cancelR2BodyBestEffort(object);
            return null;
          }
          return object;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as R2Bucket;
  return { ...env, R2: r2 };
}

function presentString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function numericOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRankingRow(
  row: Record<string, unknown>,
): RankingPoolRow | null {
  const id = presentString(row.id);
  const title = presentString(row.title);
  const creatorXId = presentString(row.creator_x_user_id);
  const displayName =
    presentString(row.display_name) ??
    presentString(row.creator_display_name) ??
    creatorXId ??
    "unknown";
  if (!id || !title) return null;
  return {
    id,
    title,
    youtube_video_id: presentString(row.youtube_video_id),
    display_name: displayName,
    creator_display_name: presentString(row.creator_display_name) ?? displayName,
    creator_x_user_id: creatorXId,
    icon_url: presentString(row.icon_url) ?? presentString(row.creator_icon_url),
    creator_icon_url:
      presentString(row.creator_icon_url) ?? presentString(row.icon_url),
    primary_event_id: presentString(row.primary_event_id),
    primary_event_title: presentString(row.primary_event_title),
    scheduled_time: numericOrNull(row.scheduled_time),
    status: "public",
    part: presentString(row.part),
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : 0,
    score_updated_at: numericOrNull(row.score_updated_at),
    updated_at: Number.isSafeInteger(Number(row.updated_at))
      ? Number(row.updated_at)
      : 0,
    youtube_privacy_status: presentString(row.youtube_privacy_status),
    youtube_availability_status: presentString(row.youtube_availability_status),
  };
}

function scheduledDesc(left: RankingPoolRow, right: RankingPoolRow): number {
  const leftTime = left.scheduled_time ?? Number.NEGATIVE_INFINITY;
  const rightTime = right.scheduled_time ?? Number.NEGATIVE_INFINITY;
  return rightTime - leftTime || left.id.localeCompare(right.id);
}

function scoreDesc(left: RankingPoolRow, right: RankingPoolRow): number {
  return right.score - left.score || scheduledDesc(left, right);
}

function scoreAsc(left: RankingPoolRow, right: RankingPoolRow): number {
  return left.score - right.score || scheduledDesc(left, right);
}

function listProjection(row: RankingPoolRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    youtube_video_id: row.youtube_video_id,
    display_name: row.display_name,
    creator_display_name: row.creator_display_name,
    creator_x_user_id: row.creator_x_user_id,
    icon_url: row.icon_url,
    creator_icon_url: row.creator_icon_url,
    primary_event_id: row.primary_event_id,
    primary_event_title: row.primary_event_title,
    scheduled_time: row.scheduled_time,
    status: row.status,
  };
}

function topProjection(row: RankingPoolRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    youtube_video_id: row.youtube_video_id,
    display_name: row.display_name,
    creator_display_name: row.creator_display_name,
    creator_x_user_id: row.creator_x_user_id,
    icon_url: row.icon_url,
    creator_icon_url: row.creator_icon_url,
    primary_event_id: row.primary_event_id,
    scheduled_time: row.scheduled_time,
    status: row.status,
    part: row.part,
  };
}

async function recordArtifact(
  env: OptimizedRebuildEnv,
  targetType: string,
  targetId: string,
  objectKey: string,
  serialized: string,
  contentHash: string,
  signal?: AbortSignal,
  sourceUpdatedAt?: number | null,
): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO static_artifacts
       (id, target_type, target_id, object_key, content_hash, schema_version,
        source_updated_at, generated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(target_type, target_id, object_key) DO UPDATE SET
       content_hash = excluded.content_hash,
       schema_version = excluded.schema_version,
       source_updated_at = excluded.source_updated_at,
       generated_at = excluded.generated_at,
       deleted_at = NULL`,
  )
    .bind(
      `sta:${targetType}:${targetId}:${objectKey}`,
      targetType,
      targetId,
      objectKey,
      contentHash,
      STATIC_ARTIFACT_SCHEMA_VERSION,
      sourceUpdatedAt ?? null,
      now,
    )
    .run();
  env.artifactHashCache?.set(objectKey, contentHash);
}

async function putTrackedJson(
  env: OptimizedRebuildEnv,
  objectKey: string,
  body: unknown,
  cacheControl: string,
  targetType: string,
  targetId = "global",
  signal?: AbortSignal,
  sourceUpdatedAt?: number | null,
): Promise<void> {
  throwIfAborted(signal);
  assertNoForbiddenPublicKeys(body);
  const serialized = JSON.stringify(body);
  const contentHash = await staticArtifactContentHash(serialized);
  const identical = await resolveIdenticalJsonArtifactPut(
    env,
    objectKey,
    serialized,
    contentHash,
  );
  throwIfAborted(signal);
  if (!identical?.skipPut) {
    await env.R2.put(objectKey, serialized, {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl,
      },
      customMetadata: staticArtifactCustomMetadata(serialized, contentHash),
    });
  }
  // R2 PUTをdedupeしても「このgenerationで正常に再構築できた」事実は更新する。
  // これを省くとdeep health / artifact SLOが同一内容のartifactを古いと誤判定する。
  await recordArtifact(
    env,
    targetType,
    targetId,
    objectKey,
    serialized,
    contentHash,
    signal,
    sourceUpdatedAt,
  );
}

function listPayloadFits(body: unknown): boolean {
  return (
    new TextEncoder().encode(JSON.stringify(body)).byteLength <=
    STATIC_LIST_MAX_OBJECT_BYTES
  );
}

async function capturePendingVideoProjectionRows(
  env: OptimizedRebuildEnv,
  signal?: AbortSignal,
): Promise<PendingRankingQueueRow[]> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `SELECT id, updated_at
     FROM static_rebuild_queue
     WHERE status = 'pending'
       AND target_id = 'global'
       AND target_type IN (${VIDEO_SOURCE_PROJECTION_TARGETS.map(() => "?").join(",")})
     LIMIT ?`,
  )
    .bind(...VIDEO_SOURCE_PROJECTION_TARGETS, RANKING_PENDING_CAPTURE_LIMIT)
    .all<PendingRankingQueueRow>();
  throwIfAborted(signal);
  return result.results ?? [];
}

async function loadCompleteRankingSnapshot(
  env: OptimizedRebuildEnv,
  signal?: AbortSignal,
): Promise<RankingPoolRow[] | null> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `SELECT
       v.id, v.title, v.youtube_video_id,
       v.creator_display_name AS display_name,
       v.creator_display_name,
       v.creator_x_user_id,
       v.creator_icon_url AS icon_url,
       v.creator_icon_url,
       e.id AS primary_event_id,
       e.title AS primary_event_title,
       v.scheduled_time,
       v.visibility_status AS status,
       v.part,
       COALESCE(v.score, 0) AS score,
       v.score_updated_at,
       v.updated_at,
       ym.youtube_privacy_status,
       ym.youtube_availability_status
     FROM videos AS v
     LEFT JOIN events AS e
       ON e.id = v.primary_event_id AND e.visibility_status = 'public'
     LEFT JOIN video_youtube_metadata AS ym ON ym.video_id = v.id
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
     ORDER BY v.id ASC
     LIMIT ?`,
  )
    .bind(RANKING_POOL_MAX_ITEMS + 1)
    .all<Record<string, unknown>>();
  throwIfAborted(signal);
  const rawRows = result.results ?? [];
  if (rawRows.length > RANKING_POOL_MAX_ITEMS) return null;
  const normalized = rawRows.map(normalizeRankingRow);
  if (normalized.some((row) => row === null)) {
    throw new Error("ranking_snapshot_contains_invalid_public_video");
  }
  return normalized as RankingPoolRow[];
}

async function loadMaterializedVideoRowsByIds(
  env: OptimizedRebuildEnv,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<RankingPoolRow[]> {
  if (ids.length === 0) return [];
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `SELECT
       v.id, v.title, v.youtube_video_id,
       v.creator_display_name AS display_name,
       v.creator_display_name,
       v.creator_x_user_id,
       v.creator_icon_url AS icon_url,
       v.creator_icon_url,
       e.id AS primary_event_id,
       e.title AS primary_event_title,
       v.scheduled_time,
       v.visibility_status AS status,
       v.part,
       COALESCE(v.score, 0) AS score,
       v.score_updated_at,
       v.updated_at,
       ym.youtube_privacy_status,
       ym.youtube_availability_status
     FROM videos AS v
     LEFT JOIN events AS e
       ON e.id = v.primary_event_id AND e.visibility_status = 'public'
     LEFT JOIN video_youtube_metadata AS ym ON ym.video_id = v.id
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       AND v.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
     LIMIT ?`,
  )
    .bind(JSON.stringify(ids), ids.length + 1)
    .all<Record<string, unknown>>();
  throwIfAborted(signal);
  const rows = (result.results ?? [])
    .map(normalizeRankingRow)
    .filter((row): row is RankingPoolRow => row !== null);
  if (rows.length > ids.length) {
    throw new Error("video_materialized_source_id_patch_overflow");
  }
  return rows;
}

async function loadScoreUpdatesSince(
  env: OptimizedRebuildEnv,
  watermark: number,
  signal?: AbortSignal,
): Promise<Array<{ id: string; score: number; score_updated_at: number }> | null> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `SELECT v.id, COALESCE(v.score, 0) AS score, v.score_updated_at
     FROM videos AS v
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       AND v.score_updated_at >= ?
     ORDER BY v.score_updated_at ASC, v.id ASC
     LIMIT ?`,
  )
    .bind(Math.max(0, watermark), RANKING_POOL_MAX_ITEMS + 1)
    .all<{ id?: unknown; score?: unknown; score_updated_at?: unknown }>();
  throwIfAborted(signal);
  const rows = result.results ?? [];
  if (rows.length > RANKING_POOL_MAX_ITEMS) return null;
  const normalized = rows.map((row) => ({
    id: String(row.id ?? "").trim(),
    score: Number(row.score ?? 0),
    score_updated_at: Number(row.score_updated_at),
  }));
  if (
    normalized.some(
      (row) =>
        !row.id ||
        !Number.isFinite(row.score) ||
        !Number.isSafeInteger(row.score_updated_at),
    )
  ) {
    throw new Error("video_materialized_source_score_patch_invalid");
  }
  return normalized;
}

async function collectPendingVideoSourceIds(
  env: OptimizedRebuildEnv,
  signal?: AbortSignal,
): Promise<string[]> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `SELECT target_id
     FROM static_rebuild_queue
     WHERE target_type = 'video'
       AND status IN ('pending', 'processing')
     GROUP BY target_id
     ORDER BY MAX(updated_at) DESC, target_id ASC
     LIMIT ?`,
  )
    .bind(MATERIALIZED_VIDEO_DIRTY_TARGET_LIMIT + 1)
    .all<{ target_id?: unknown }>();
  throwIfAborted(signal);
  return (result.results ?? [])
    .map((row) => String(row.target_id ?? "").trim())
    .filter(Boolean);
}

function sourceRows(rows: readonly RankingPoolRow[]): RankingPoolRow[] {
  return rows
    .map((row) => ({ ...row, primary_event_title: null }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function scoreWatermark(rows: readonly RankingPoolRow[]): number {
  return rows.reduce(
    (max, row) => Math.max(max, row.score_updated_at ?? 0),
    0,
  );
}

async function bootstrapVideoSourceRows(
  env: OptimizedRebuildEnv,
  signal?: AbortSignal,
): Promise<RankingPoolRow[] | null> {
  const rows = await loadCompleteRankingSnapshot(env, signal);
  return rows ? sourceRows(rows) : null;
}

async function syncVideoMaterializedSource(
  env: OptimizedRebuildEnv,
  extraVideoIds: readonly string[] = [],
  signal?: AbortSignal,
): Promise<RankingPoolRow[] | null> {
  const pendingIds = await collectPendingVideoSourceIds(env, signal);
  const pendingOverflow = pendingIds.length > MATERIALIZED_VIDEO_DIRTY_TARGET_LIMIT;
  const explicitIds = extraVideoIds.map((id) => id.trim()).filter(Boolean);
  const dirtyIds = Array.from(new Set([...pendingIds, ...explicitIds]));

  try {
    const result = await mutateVideoMaterializedSource(
      env,
      async (rows, current) => {
      if (pendingOverflow) {
        // A rare mass update is safer as a full repair than a partial snapshot.
        const complete = await bootstrapVideoSourceRows(env, signal);
        if (!complete) throw new Error("video_materialized_source_overflow");
        return {
          rows: complete,
          scoreWatermark: scoreWatermark(complete),
          sourceUpdatedAt: complete.reduce(
            (max, row) => Math.max(max, row.updated_at),
            0,
          ),
        };
      }

      let nextRows = new Map(rows.map((row) => [row.id, row]));
      if (dirtyIds.length > 0) {
        const changedRows = await loadMaterializedVideoRowsByIds(
          env,
          dirtyIds,
          signal,
        );
        for (const id of dirtyIds) nextRows.delete(id);
        for (const row of sourceRows(changedRows)) nextRows.set(row.id, row);
      }

      let nextWatermark = current?.score_watermark ?? scoreWatermark(rows);
      if (current) {
        const scoreRows = await loadScoreUpdatesSince(env, nextWatermark, signal);
        if (!scoreRows) throw new Error("video_materialized_source_overflow");
        for (const scoreRow of scoreRows) {
          const existing = nextRows.get(scoreRow.id);
          if (existing) {
            nextRows.set(scoreRow.id, {
              ...existing,
              score: scoreRow.score,
              score_updated_at: scoreRow.score_updated_at,
            });
          }
          nextWatermark = Math.max(nextWatermark, scoreRow.score_updated_at);
        }
      }

      const sortedRows = [...nextRows.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      if (sortedRows.length > VIDEO_MATERIALIZED_SOURCE_MAX_ROWS) {
        throw new Error("video_materialized_source_overflow");
      }
      return {
        rows: sortedRows,
        scoreWatermark: nextWatermark,
        sourceUpdatedAt: sortedRows.reduce(
          (max, row) => Math.max(max, row.updated_at),
          0,
        ),
      };
      },
      {
        bootstrap: () => bootstrapVideoSourceRows(env, signal),
        signal,
      },
    );
    return result?.source.rows ?? null;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "video_materialized_source_overflow"
    ) return null;
    throw error;
  }
}

async function attachCurrentEventTitles(
  env: OptimizedRebuildEnv,
  rows: readonly RankingPoolRow[],
  signal?: AbortSignal,
): Promise<RankingPoolRow[]> {
  const eventIds = Array.from(
    new Set(rows.map((row) => row.primary_event_id).filter((id): id is string => Boolean(id))),
  );
  if (eventIds.length === 0) return rows.map((row) => ({ ...row, primary_event_title: null }));
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `SELECT id, title
     FROM events
     WHERE visibility_status = 'public'
       AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
  )
    .bind(JSON.stringify(eventIds))
    .all<{ id?: unknown; title?: unknown }>();
  throwIfAborted(signal);
  const titles = new Map(
    (result.results ?? []).map((row) => [
      String(row.id ?? "").trim(),
      String(row.title ?? "").trim(),
    ]),
  );
  return rows.map((row) => ({
    ...row,
    primary_event_title: row.primary_event_id
      ? titles.get(row.primary_event_id) ?? null
      : null,
  }));
}

async function patchVideoMaterializedSource(
  env: OptimizedRebuildEnv,
  videoId: string,
  signal?: AbortSignal,
): Promise<void> {
  const sourceRows = await syncVideoMaterializedSource(env, [videoId], signal);
  // A >5000-row public corpus uses the existing D1 bounded fallback. Never
  // publish a truncated materialized source to make the incremental path fit.
  if (!sourceRows && signal?.aborted) throwIfAborted(signal);
}

async function markCoveredRankingRowsDone(
  env: OptimizedRebuildEnv,
  coveredRows: readonly PendingRankingQueueRow[],
  signal?: AbortSignal,
): Promise<void> {
  if (coveredRows.length === 0) return;
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  // 50件のD1 batchは1回のhard limitを消費し切るため、JSON1の単一UPDATEにする。
  // target_type / updated_at CASで処理中の再enqueueをdoneにしない。
  await env.DB.prepare(
    `WITH covered_rows AS (
       SELECT
         CAST(json_extract(value, '$.id') AS TEXT) AS id,
         CAST(json_extract(value, '$.target_type') AS TEXT) AS target_type,
         CAST(json_extract(value, '$.updated_at') AS INTEGER) AS updated_at
       FROM json_each(?)
     )
     UPDATE static_rebuild_queue
        SET status = 'done',
            processed_at = ?,
            attempt_count = 0,
            error = NULL,
            processing_started_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            next_retry_at = NULL,
            updated_at = ?
      WHERE status = 'pending'
        AND EXISTS (
          SELECT 1
            FROM covered_rows
           WHERE covered_rows.id = static_rebuild_queue.id
             AND covered_rows.target_type = static_rebuild_queue.target_type
             AND covered_rows.updated_at = static_rebuild_queue.updated_at
        )`,
  )
    .bind(JSON.stringify(coveredRows), now, now)
    .run();
  throwIfAborted(signal);
}

async function rebuildRankingBundle(
  env: OptimizedRebuildEnv,
  triggerTargetType: string,
  signal?: AbortSignal,
  sourceUpdatedAt?: number,
): Promise<{ followUpPending: boolean } | null> {
  const pendingRows = await capturePendingVideoProjectionRows(env, signal);
  const materializedRows = await syncVideoMaterializedSource(env, [], signal);
  if (!materializedRows) return null;
  const shouldBuildRanking =
    RANKING_TARGET_SET.has(triggerTargetType) ||
    pendingRows.some((row) => RANKING_TARGET_SET.has(row.target_type));
  const auxiliaryTargets = new Set(
    pendingRows
      .map((row) => row.target_type)
      .filter((type) => type === "search_index" || type === "random_video_pool"),
  );
  if (triggerTargetType === "search_index" || triggerTargetType === "random_video_pool") {
    auxiliaryTargets.add(triggerTargetType);
  }

  let followUpPending = false;
  if (shouldBuildRanking) {
    const pool = await attachCurrentEventTitles(env, materializedRows, signal);
    const now = Math.floor(Date.now() / 1000);
    const recentItems = [...pool].sort(scheduledDesc);
    const popularItems = [...pool].sort(scoreDesc);
    const underratedItems = [...pool].sort(scoreAsc);
    const recentPayload = {
      generated_at: now,
      total: recentItems.length,
      items: recentItems.map(listProjection),
    };
    const popularPayload = {
      generated_at: now,
      total: popularItems.length,
      items: popularItems.map(listProjection),
    };

    // 5000件以下でも文字列が大きいとlist artifactの8MB上限を超え得る。
    // その場合は既存target実装へfallbackし、pending CASも行わない。
    if (!listPayloadFits(recentPayload) || !listPayloadFits(popularPayload)) {
      return null;
    }

    await Promise.all([
      putTrackedJson(
        env,
        "list/recent.json",
        recentPayload,
        staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.listRecent),
        "list_recent",
        "global",
        signal,
        sourceUpdatedAt,
      ),
      putTrackedJson(
        env,
        "list/popular.json",
        popularPayload,
        staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.listPopular),
        "list_popular",
        "global",
        signal,
        sourceUpdatedAt,
      ),
      putTrackedJson(
        env,
        TOP_RECOMMENDED_OBJECT_KEY,
        {
          schema_version: TOP_SECTIONS_SCHEMA_VERSION,
          generated_at: now,
          items: popularItems.slice(0, 40).map(topProjection),
        },
        staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.top),
        "top_recommended",
        "global",
        signal,
        sourceUpdatedAt,
      ),
      putTrackedJson(
        env,
        TOP_LATEST_OBJECT_KEY,
        {
          schema_version: TOP_SECTIONS_SCHEMA_VERSION,
          generated_at: now,
          items: recentItems.slice(0, 100).map(topProjection),
        },
        staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.top),
        "top_latest",
        "global",
        signal,
        sourceUpdatedAt,
      ),
      putTrackedJson(
        env,
        RECOMMEND_CORE_OBJECT_KEY,
        {
          schema_version: RECOMMEND_CORE_SCHEMA_VERSION,
          generated_at: now,
          recommended: popularItems.slice(0, 180).map(topProjection),
          latest: recentItems.slice(0, 120).map(topProjection),
          underrated: underratedItems.slice(0, 120).map(topProjection),
        },
        staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.recommend),
        "recommend_core",
        "global",
        signal,
        sourceUpdatedAt,
      ),
    ]);

    throwIfAborted(signal);
    const followUps = await Promise.all([
      enqueueComposerFollowUps(env, "top_recommended"),
      enqueueComposerFollowUps(env, "top_latest"),
      enqueueComposerFollowUps(env, "recommend_core"),
    ]);
    followUpPending = followUps.some(Boolean);
  }

  const sourceBackedEnv = { ...env, videoSourceRows: materializedRows };
  for (const targetType of auxiliaryTargets) {
    throwIfAborted(signal);
    const result = await rebuildTarget(
      withBoundedAbortSafeR2(sourceBackedEnv, signal),
      targetType,
      "global",
      signal,
    );
    followUpPending ||= result.followUpPending;
  }

  const coveredRows = pendingRows.filter((row) =>
    RANKING_TARGET_SET.has(row.target_type)
      ? shouldBuildRanking
      : auxiliaryTargets.has(row.target_type),
  );
  // Active enqueueのupdated_at CASで、処理中に再enqueueされた行は残す。
  await markCoveredRankingRowsDone(env, coveredRows, signal);

  return {
    followUpPending,
  };
}

async function markEventPlaylistDeleted(
  env: OptimizedRebuildEnv,
  eventId: string,
  objectKey: string,
): Promise<void> {
  await env.R2.delete(objectKey);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE static_artifacts
     SET deleted_at = ?
     WHERE target_type = 'event_playlist'
       AND target_id = ?
       AND object_key = ?
       AND deleted_at IS NULL`,
  )
    .bind(now, eventId, objectKey)
    .run();
}

async function syncEventPlaylistArtifact(
  env: OptimizedRebuildEnv,
  eventId: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const objectKey = eventPlaylistObjectKey(eventId);
  const event = await env.DB.prepare(
    `SELECT visibility_status, updated_at FROM events WHERE id = ? LIMIT 1`,
  )
    .bind(eventId)
    .first<{ visibility_status?: string; updated_at?: number }>();
  throwIfAborted(signal);
  if (event?.visibility_status !== "public") {
    await markEventPlaylistDeleted(env, eventId, objectKey);
    return;
  }

  const result = await env.DB.prepare(
    `SELECT
       v.id,
       v.title,
       v.youtube_video_id,
       COALESCE(NULLIF(TRIM(v.creator_display_name), ''), v.creator_x_user_id) AS display_name,
       v.scheduled_time
     FROM videos AS v
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       AND (
         EXISTS (
           SELECT 1 FROM video_events AS event_video_links
           WHERE event_video_links.video_id = v.id
             AND event_video_links.event_id = ?
         )
         OR v.primary_event_id = ?
       )
     ORDER BY v.scheduled_time IS NULL ASC, v.scheduled_time ASC, v.id ASC
     LIMIT ?`,
  )
    .bind(eventId, eventId, EVENT_PLAYLIST_MAX_ITEMS + 1)
    .all<Record<string, unknown>>();
  throwIfAborted(signal);
  const rows = result.results ?? [];
  const complete = rows.length <= EVENT_PLAYLIST_MAX_ITEMS;
  const items = rows.slice(0, EVENT_PLAYLIST_MAX_ITEMS).map((row) => ({
    id: String(row.id ?? "").trim(),
    title: String(row.title ?? "").trim(),
    youtube_video_id: presentString(row.youtube_video_id),
    display_name:
      presentString(row.display_name) ?? presentString(row.id) ?? "unknown",
    scheduled_time: numericOrNull(row.scheduled_time),
  }));
  if (items.some((item) => !item.id || !item.title || !item.display_name)) {
    throw new Error("event_playlist_contains_invalid_public_video");
  }
  const playlistPayload = {
    schema_version: EVENT_PLAYLIST_SCHEMA_VERSION,
    generated_at: Math.floor(Date.now() / 1000),
    event_id: eventId,
    complete,
    items,
  };
  const serializedPlaylist = JSON.stringify(playlistPayload);
  if (
    new TextEncoder().encode(serializedPlaylist).byteLength >
    EVENT_PLAYLIST_MAX_OBJECT_BYTES
  ) {
    throw new Error("event_playlist_object_too_large");
  }
  await putTrackedJson(
    env,
    objectKey,
    playlistPayload,
    staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.eventDetail),
    "event_playlist",
    eventId,
    signal,
    Number(event?.updated_at ?? 0) || null,
  );
}

export async function optimizedRebuildTarget(
  env: OptimizedRebuildEnv,
  targetType: string,
  targetId: string,
  sourceUpdatedAt: number,
  signal?: AbortSignal,
  reason?: string | null,
): Promise<{ followUpPending: boolean }> {
  throwIfAborted(signal);

  const videoProjectionBundleAttempted =
    VIDEO_SOURCE_PROJECTION_TARGET_SET.has(targetType);
  if (videoProjectionBundleAttempted) {
    const bundled = await rebuildRankingBundle(
      env,
      targetType,
      signal,
      sourceUpdatedAt,
    );
    if (bundled) return bundled;
  }

  let rebuildEnv = env;
  if (targetType === "video") {
    await patchVideoMaterializedSource(env, targetId, signal);
  } else if (
    !videoProjectionBundleAttempted &&
    (targetType === "search_index" || targetType === "random_video_pool")
  ) {
    const videoSourceRows = await syncVideoMaterializedSource(env, [], signal);
    if (videoSourceRows) rebuildEnv = { ...env, videoSourceRows };
  }

  const legacyEnv = withBoundedAbortSafeR2(rebuildEnv, signal);
  const result = await rebuildTarget(
    legacyEnv,
    targetType,
    targetId,
    signal,
    reason,
  );
  if (targetType === "users_index") {
    const v2 = await rebuildUsersIndexV2FromLegacyArtifact(env, signal, {
      forceRepair:
        typeof reason === "string" &&
        (reason.includes("miss") ||
          reason.includes("repair") ||
          reason.includes("visibility") ||
          reason.includes("deploy_generator_change")),
    });
    try {
      await rebuildPublicIconV2FromLegacyArtifact(env, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(
        JSON.stringify({
          service: "public-icon-v2",
          result: "v1_fallback",
          error_name: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
    if (v2.hasMore) return { followUpPending: true };
  }
  if (targetType === "event_base") {
    await syncEventPlaylistArtifact(env, targetId, signal);
    // rebuildTarget enqueues the event composer before this optimized
    // playlist projection runs.  A concurrent queue consumer can therefore
    // finish the composer while event_playlist is still stale, leaving a
    // release_pending visibility fence stranded.  Bump/insert the composer
    // after the playlist write as a bounded, idempotent follow-up; the unique
    // pending/processing target index coalesces the usual non-racing case.
    const composerFollowUpPending = await enqueuePerTargetComposerFollowUp(
      env,
      "event_base",
      targetId,
    );
    return {
      ...result,
      followUpPending: result.followUpPending || composerFollowUpPending,
    };
  }
  return result;
}
