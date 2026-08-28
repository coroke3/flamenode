import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  resolveIdenticalJsonArtifactPut,
  staticArtifactContentHash,
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
// 滞留した重複世代で、1回の再構築が無制限にqueueを読み込まないようにする。
// 通常はtargetごとにactive行が1件だけなので、平常時の結果は変わらない。
const RANKING_PENDING_CAPTURE_LIMIT = 50;

type RankingPoolRow = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  creator_display_name: string;
  creator_x_user_id: string | null;
  icon_url: string | null;
  creator_icon_url: string | null;
  primary_event_id: string | null;
  primary_event_title: string | null;
  scheduled_time: number | null;
  status: "public";
  part: string | null;
  score: number;
};

type PendingRankingQueueRow = {
  id: string;
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
  signal?: AbortSignal,
  sourceUpdatedAt?: number | null,
): Promise<void> {
  throwIfAborted(signal);
  const contentHash = await staticArtifactContentHash(serialized);
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
  const identical = await resolveIdenticalJsonArtifactPut(
    env,
    objectKey,
    serialized,
  );
  throwIfAborted(signal);
  if (!identical) {
    await env.R2.put(objectKey, serialized, {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl,
      },
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

async function capturePendingRankingRows(
  env: OptimizedRebuildEnv,
  signal?: AbortSignal,
): Promise<PendingRankingQueueRow[]> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `SELECT id, updated_at
     FROM static_rebuild_queue
     WHERE status = 'pending'
       AND target_id = 'global'
       AND target_type IN (${RANKING_TARGETS.map(() => "?").join(",")})
     LIMIT ?`,
  )
    .bind(...RANKING_TARGETS, RANKING_PENDING_CAPTURE_LIMIT)
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
       COALESCE(v.score, 0) AS score
     FROM videos AS v
     LEFT JOIN events AS e
       ON e.id = v.primary_event_id AND e.visibility_status = 'public'
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

async function markCoveredRankingRowsDone(
  env: OptimizedRebuildEnv,
  coveredRows: readonly PendingRankingQueueRow[],
  signal?: AbortSignal,
): Promise<void> {
  if (coveredRows.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];
  for (const row of coveredRows) {
    throwIfAborted(signal);
    statements.push(
      env.DB.prepare(
        `UPDATE static_rebuild_queue
         SET status = 'done',
             processed_at = ?,
             attempt_count = 0,
             error = NULL,
             processing_started_at = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             next_retry_at = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'pending'
           AND updated_at = ?`,
      ).bind(now, now, row.id, row.updated_at),
    );
  }
  // D1 round-tripを1回にまとめ、各行のupdated_at CAS条件は維持する。
  await env.DB.batch(statements);
}

async function rebuildRankingBundle(
  env: OptimizedRebuildEnv,
  signal?: AbortSignal,
): Promise<{ followUpPending: boolean } | null> {
  const coveredRows = await capturePendingRankingRows(env, signal);
  const pool = await loadCompleteRankingSnapshot(env, signal);
  if (!pool) return null;

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
  // bundle全体を失敗させず既存target SQLへfallbackし、top/recommendを巻き込まない。
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
    ),
    putTrackedJson(
      env,
      "list/popular.json",
      popularPayload,
      staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.listPopular),
      "list_popular",
      "global",
      signal,
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
    ),
  ]);

  throwIfAborted(signal);
  const [topRecommendedFollowUp, topLatestFollowUp, recommendFollowUp] =
    await Promise.all([
      enqueueComposerFollowUps(env, "top_recommended"),
      enqueueComposerFollowUps(env, "top_latest"),
      enqueueComposerFollowUps(env, "recommend_core"),
    ]);

  // Active enqueueはupdated_atを必ず+1以上進めるため、同一秒の再enqueueも
  // このCAS条件から外れてpendingのまま残り、次generationで再構築される。
  await markCoveredRankingRowsDone(env, coveredRows, signal);

  return {
    followUpPending:
      topRecommendedFollowUp || topLatestFollowUp || recommendFollowUp,
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
    `UPDATE static_rebuild_queue
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
  _sourceUpdatedAt: number,
  signal?: AbortSignal,
  reason?: string | null,
): Promise<{ followUpPending: boolean }> {
  throwIfAborted(signal);

  if (RANKING_TARGET_SET.has(targetType)) {
    const bundled = await rebuildRankingBundle(env, signal);
    if (bundled) return bundled;
  }

  const legacyEnv = withBoundedAbortSafeR2(env, signal);
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
