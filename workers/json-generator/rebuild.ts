import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  cacheControlForFreshness,
  resolveEventFreshness,
} from "./freshness.ts";
import { staticArtifactContentHash, resolveIdenticalJsonArtifactPut } from "./r2Dedup.ts";
import { staticRebuildArtifactTargetId } from "./staticGlobalRebuildTargets.ts";
import {
  staticR2CacheControl,
  STATIC_R2_MAX_AGE_SEC,
} from "../shared/staticR2CacheControl.ts";
import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../../src/lib/utils/publicXUser.ts";
import {
  DEFAULT_TERMS_MARKDOWN,
  DEFAULT_TERMS_VERSION_LABEL,
} from "../../src/lib/terms/defaultTerms.ts";
import {
  clampRelatedLimit,
  enforceDiversity,
  interleaveBuckets,
  perMemberLimit,
  uniqueByVideoId,
} from "../../src/lib/db/recommendation.ts";
import {
  COUNTABLE_PUBLIC_VIDEO_SQL,
  PVSF_SUMMARY_EVENT_ID,
} from "../../src/lib/publicData/countablePublicVideoSql.ts";
import { jstDayKey, resolveNostalgicDisplaySelection } from "../../src/lib/publicData/topNostalgicDaily.ts";
import { YOUTUBE_SYNCED_PLAYABLE_SQL } from "../../src/lib/publicData/youtubeSyncedPlayableSql.ts";
import {
  buildPickupCreatorsArtifactFromProjection,
  buildPublicUsersIndexItems,
  loadPublicCreatorProjectionSources,
  PICKUP_CREATORS_MAX_OBJECT_BYTES,
  PICKUP_CREATORS_OBJECT_KEY,
  pickupCreatorsArtifactByteLength,
  USERS_INDEX_MAX_OBJECT_BYTES,
  USERS_INDEX_OBJECT_KEY,
} from "../../src/lib/publicData/publicCreatorProjection.ts";
import {
  buildPublicXIconMapPayloadFromProjection,
  PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES,
  PUBLIC_X_ICON_MAP_OBJECT_KEY,
  publicXIconMapByteLength,
} from "../../src/lib/publicData/publicIconProjection.ts";
import {
  buildYoutubeRelatedBlocklistPayload,
  normalizeYoutubeRelatedBlocklist,
  YOUTUBE_RELATED_BLOCKLIST_MAX_OBJECT_BYTES,
  YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
  type YoutubeRelatedBlocklist,
  type YoutubeRelatedBlockReason,
} from "../../src/lib/publicData/staticYoutubeRelatedBlocklistCore.ts";
import {
  buildRandomPoolGenerationMaterial,
  EMPTY_RANDOM_VIDEO_POOL,
  normalizeRandomVideoPool,
  RANDOM_VIDEO_POOL_MAX_OBJECT_BYTES,
  RANDOM_VIDEO_POOL_OBJECT_KEY,
  RANDOM_VIDEO_POOL_SCHEMA_VERSION,
  type RandomVideoPool,
} from "../../src/lib/publicData/randomVideoPoolCore.ts";
import type {
  StaticRelatedVideo,
} from "../../src/lib/publicData/staticVideoDetailCore.ts";
import {
  RELATED_DEFAULT_LIMIT,
  RELATED_MAX_LIMIT,
  RELATED_MIN_LIMIT,
  RELATED_RANDOM_LIMIT,
  RELATED_RANDOM_RESERVE_LIMIT,
  RELATED_RESERVE_LIMIT,
  RELATED_SECTION_MAX_BYTES,
  insertRandomRelatedVideos,
  relatedSectionByteLength,
  selectDeterministicRandom,
} from "../../src/lib/publicData/relatedVideoProjection.ts";
import {
  projectMemberChapters,
} from "../../src/lib/video/memberChapterProjection.ts";
import { isConfirmedInternalVideoId } from "../../src/lib/video/internalId.ts";
import { buildHeroEventSlotStatsSql } from "../../src/lib/publicData/heroEventSlotStatsSql.ts";
import {
  normalizeStaticTopSlotStats,
  TOP_SLOT_STATS_MAX_OBJECT_BYTES,
  TOP_SLOT_STATS_OBJECT_KEY,
  TOP_SLOT_STATS_SCHEMA_VERSION,
  topSlotStatsArtifactByteLength,
} from "../../src/lib/publicData/staticTopSlotStatsCore.ts";
import {
  normalizeTopAnnouncementsSection,
  normalizeTopEventsSection,
  normalizeTopLatestSection,
  normalizeTopNostalgicSection,
  normalizeTopRecommendedSection,
  normalizeTopStatsSection,
  TOP_ANNOUNCEMENTS_OBJECT_KEY,
  TOP_EVENTS_OBJECT_KEY,
  TOP_LATEST_OBJECT_KEY,
  TOP_NOSTALGIC_OBJECT_KEY,
  TOP_RECOMMENDED_OBJECT_KEY,
  TOP_SECTIONS_SCHEMA_VERSION,
  TOP_STATS_OBJECT_KEY,
} from "../../src/lib/publicData/staticTopSectionsCore.ts";
import {
  normalizeRecommendCore,
  RECOMMEND_CORE_OBJECT_KEY,
  RECOMMEND_CORE_SCHEMA_VERSION,
} from "../../src/lib/publicData/staticRecommendCore.ts";
import {
  pickHeroEvents,
  type HeroEventRow,
} from "../../src/lib/utils/pickHeroEvents.ts";
import { enqueueComposerFollowUps, enqueuePerTargetComposerFollowUp } from "./followUpEnqueue.ts";
import { resolvePickupCreatorsWithFallback } from "./pickupCreatorsR2.ts";
import { enqueueTopSectionRebuild } from "./topRebuildEnqueue.ts";
import {
  readWorkerVisibilityBlockedEntitiesManifest,
  releaseBlockedEntityInManifest,
  writeWorkerVisibilityBlockedEntitiesManifest,
  type PublicVisibilityFenceEntityType,
} from "../shared/publicVisibilityManifest.ts";

export const TOP_NOSTALGIC_SHUFFLE_DAY_KV_KEY = "static:top_nostalgic_shuffle_day";

const STATIC_USER_WORKS_PAGE_SIZE = 24;
const STATIC_USER_COLLABS_PAGE_SIZE = 24;
const STATIC_USER_MAX_PAGES = 5;
const STATIC_USER_MAX_STATIC_ITEMS =
  STATIC_USER_WORKS_PAGE_SIZE * STATIC_USER_MAX_PAGES;

import type { ArtifactHashCache } from "./r2Dedup.ts";

type Env = {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  artifactHashCache?: ArtifactHashCache;
};
type RebuildSignal = AbortSignal | undefined;
type ArtifactTarget = { targetType: string; targetId: string; sourceUpdatedAt?: number | null };
type ArtifactRow = { object_key: string };
const STATIC_ARTIFACT_SCHEMA_VERSION = 1;
export const EVENTS_INDEX_MAX_ROWS = 200;
export const EVENT_GROUP_MAX_ROWS = 50;
export const EVENT_GROUP_EVENT_MAX_PER_GROUP = 20;
export const EVENT_GROUP_EVENT_MAX_ROWS =
  EVENT_GROUP_MAX_ROWS * EVENT_GROUP_EVENT_MAX_PER_GROUP;
export const PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE = 90;
export const PUBLIC_STAFF_MAX_PER_EVENT = 20;
export const TOP_LATEST_LIMIT = 100;
export const TOP_NOSTALGIA_LIMIT = 20;
export const TOP_NOSTALGIA_POOL = 200;

const TOP_PUBLIC_VIDEO_SELECT = `
  id, title, youtube_video_id,
  creator_display_name AS display_name,
  creator_display_name,
  creator_x_user_id,
  creator_icon_url AS icon_url,
  creator_icon_url,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  scheduled_time,
  visibility_status AS status,
  part
`;

const TOP_SECTION_PRODUCER_TARGET_TYPES = [
  "top_recommended",
  "top_latest",
  "top_nostalgic",
  "top_events",
  "top_announcements",
  "top_stats",
] as const;

function unixYearsAgo(nowSec: number, years: number): number {
  const date = new Date(nowSec * 1000);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return Math.floor(date.getTime() / 1000);
}

const EVENT_INDEX_COLUMNS = `
  id, title, explanation, icon_url, img_url, accent_color,
  event_type, slot_type, slot_visibility_mode,
  max_slots_per_video,
  start_time, end_time, entry_start_time, entry_end_time,
  visibility_status, created_at
`;

/** COUNTABLE 公開作品を list / search-index の items に載せる上限。 */
export const STATIC_LIST_MAX_ITEMS = 5000;
export const RECENT_LIST_LIMIT = STATIC_LIST_MAX_ITEMS;
export const POPULAR_LIST_LIMIT = STATIC_LIST_MAX_ITEMS;
export const SEARCH_INDEX_VIDEO_LIMIT = STATIC_LIST_MAX_ITEMS;
export const STATIC_LIST_MAX_OBJECT_BYTES = 8 * 1024 * 1024;

export function capStaticListTotal(counted: number, items: readonly unknown[]): number {
  const safeCounted =
    Number.isFinite(counted) && counted >= 0 ? counted : items.length;
  return Math.min(safeCounted, items.length);
}

function assertStaticListObjectSize(key: string, body: unknown): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  if (byteLength > STATIC_LIST_MAX_OBJECT_BYTES) {
    throw new Error(
      `${key} exceeds size limit (${byteLength} > ${STATIC_LIST_MAX_OBJECT_BYTES} bytes)`,
    );
  }
}

const STATIC_LIST_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  v.creator_display_name AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  e.id AS primary_event_id,
  e.title AS primary_event_title,
  v.scheduled_time,
  v.visibility_status AS status
`;

const STATIC_LIST_VIDEO_FROM = `
  FROM videos AS v
  LEFT JOIN events AS e
    ON e.id = v.primary_event_id AND e.visibility_status = 'public'
`;

const EVENT_DETAIL_COLUMNS = `
  id, title, explanation, icon_url, img_url, accent_color,
  event_type, slot_type, slot_visibility_mode,
  max_slots_per_video, slot_part_gap_minutes,
  start_time, end_time, entry_start_time, entry_end_time,
  visibility_status, updated_at
`;

function eventPublicVideoWhereSql(videoAlias = "v"): string {
  return `
    ${videoAlias}.visibility_status = 'public'
    AND (
      EXISTS (
        SELECT 1 FROM video_events AS event_video_links
        WHERE event_video_links.video_id = ${videoAlias}.id
          AND event_video_links.event_id = ?
      )
      OR ${videoAlias}.primary_event_id = ?
    )
    AND COALESCE(${videoAlias}.primary_event_id, '') <> '${PVSF_SUMMARY_EVENT_ID}'
    AND NOT EXISTS (
      SELECT 1 FROM video_events AS pvsf_summary_video_events
      WHERE pvsf_summary_video_events.video_id = ${videoAlias}.id
        AND pvsf_summary_video_events.event_id = '${PVSF_SUMMARY_EVENT_ID}'
    )
  `;
}

const STATIC_RECOMMEND_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  v.creator_display_name AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  v.scheduled_time,
  v.visibility_status AS status,
  v.part
`;

/** 点イベント（片方だけ期間設定）を除外する WHERE 句。 */
const NON_POINT_EVENT_PERIOD_SQL = `(
  (start_time IS NULL AND end_time IS NULL)
  OR (start_time IS NOT NULL AND end_time IS NOT NULL)
)`;

function throwIfAborted(signal: RebuildSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(signal.reason === undefined ? "static rebuild aborted" : String(signal.reason));
}

export async function rebuildTarget(
  env: Env,
  targetType: string,
  targetId: string,
  signal?: AbortSignal,
  reason?: string | null,
): Promise<{ followUpPending: boolean }> {
  throwIfAborted(signal);
  let followUpPending = false;
  if (env.artifactHashCache) {
    await env.artifactHashCache.preload(
      env.DB,
      targetType,
      staticRebuildArtifactTargetId(targetType, targetId),
      signal,
    );
  }
  switch (targetType) {
    case "top":
      await rebuildTop(env, signal);
      break;
    case "top_recommended":
      await rebuildTopRecommended(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "top_recommended");
      break;
    case "top_latest":
      await rebuildTopLatest(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "top_latest");
      break;
    case "top_nostalgic":
      await rebuildTopNostalgic(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "top_nostalgic");
      break;
    case "top_events":
      await rebuildTopEvents(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "top_events");
      break;
    case "top_announcements":
      await rebuildTopAnnouncements(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "top_announcements");
      break;
    case "top_stats":
      await rebuildTopStats(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "top_stats");
      break;
    case "top_slot_stats":
      await rebuildTopSlotStats(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "top_slot_stats");
      break;
    case "list_recent":
      await rebuildListRecent(env, signal);
      break;
    case "events_index":
      await rebuildEventsIndex(env, signal);
      break;
    case "search_index":
      await rebuildSearchIndexLite(env, signal);
      break;
    case "event_base": {
      const shouldCompose = await rebuildEventBase(env, targetId, signal);
      if (shouldCompose) {
        followUpPending = await enqueuePerTargetComposerFollowUp(
          env,
          "event_base",
          targetId,
        );
      }
      break;
    }
    case "event_slots": {
      const shouldCompose = await rebuildEventSlots(env, targetId, signal);
      if (shouldCompose) {
        followUpPending = await enqueuePerTargetComposerFollowUp(
          env,
          "event_slots",
          targetId,
        );
      }
      break;
    }
    case "event":
      await rebuildEvent(env, targetId, signal, reason);
      break;
    case "video":
      await rebuildVideo(env, targetId, signal, reason);
      break;
    case "user":
      await rebuildUser(env, targetId, signal);
      break;
    case "users_index":
      await rebuildUsersIndex(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "users_index");
      break;
    case "list_popular":
      await rebuildListPopular(env, signal);
      break;
    case "recommend_core":
      await rebuildRecommendCore(env, signal);
      followUpPending = await enqueueComposerFollowUps(env, "recommend_core");
      break;
    case "recommend":
      await rebuildRecommend(env, signal);
      break;
    case "rules":
      await rebuildRules(env, signal);
      break;
    case "youtube_related_blocklist":
      await rebuildYoutubeRelatedBlocklist(env, signal);
      break;
    case "random_video_pool":
      await rebuildRandomVideoPool(env, signal);
      break;
    default:
      throw new Error(`Unknown target_type: ${targetType}`);
  }
  throwIfAborted(signal);
  if ([
    "top",
    ...TOP_SECTION_PRODUCER_TARGET_TYPES,
    "top_slot_stats",
    "list_recent",
    "list_popular",
    "events_index",
    "search_index",
    "users_index",
    "recommend_core",
    "recommend",
    "rules",
    "youtube_related_blocklist",
    "random_video_pool",
  ].includes(targetType)) {
    const keys: Record<string, string | string[]> = {
      top: "top.json",
      top_recommended: TOP_RECOMMENDED_OBJECT_KEY,
      top_latest: TOP_LATEST_OBJECT_KEY,
      top_nostalgic: TOP_NOSTALGIC_OBJECT_KEY,
      top_events: TOP_EVENTS_OBJECT_KEY,
      top_announcements: TOP_ANNOUNCEMENTS_OBJECT_KEY,
      top_stats: TOP_STATS_OBJECT_KEY,
      top_slot_stats: TOP_SLOT_STATS_OBJECT_KEY,
      list_recent: "list/recent.json",
      list_popular: "list/popular.json",
      events_index: "events/index.json",
      search_index: "search-index-lite.json",
      users_index: [USERS_INDEX_OBJECT_KEY, PUBLIC_X_ICON_MAP_OBJECT_KEY, PICKUP_CREATORS_OBJECT_KEY],
      recommend_core: RECOMMEND_CORE_OBJECT_KEY,
      recommend: "recommend.json",
      rules: "rules/current.json",
      youtube_related_blocklist: YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
      random_video_pool: RANDOM_VIDEO_POOL_OBJECT_KEY,
    };
    const objectKeys = keys[targetType];
    await reconcileTrackedArtifacts(
      env,
      { targetType, targetId: "global" },
      Array.isArray(objectKeys) ? objectKeys : [objectKeys],
      20,
      signal,
    );
  }
  return { followUpPending };
}

async function putJson(
  env: Env,
  key: string,
  body: unknown,
  cacheControl: string,
  target?: ArtifactTarget,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  assertNoForbiddenPublicKeys(body);
  const serialized = JSON.stringify(body);
  throwIfAborted(signal);
  if (await resolveIdenticalJsonArtifactPut(env, key, serialized)) {
    return;
  }
  await env.R2.put(key, serialized, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl,
    },
  });
  throwIfAborted(signal);
  if (target) await recordArtifact(env, target, key, serialized, signal);
}

async function recordArtifact(
  env: Env,
  target: ArtifactTarget,
  objectKey: string,
  body: string,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  const contentHash = await staticArtifactContentHash(body);
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const id = `sta:${target.targetType}:${target.targetId}:${objectKey}`;
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
  ).bind(
    id,
    target.targetType,
    target.targetId,
    objectKey,
    contentHash,
    STATIC_ARTIFACT_SCHEMA_VERSION,
    target.sourceUpdatedAt ?? null,
    now,
  ).run();
  throwIfAborted(signal);
}

export async function removeTrackedArtifacts(
  env: Env,
  targetType: string,
  targetId: string,
  limit = 20,
  signal?: RebuildSignal,
): Promise<number> {
  throwIfAborted(signal);
  const rows = await env.DB.prepare(
    `SELECT object_key FROM static_artifacts
     WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
     ORDER BY generated_at ASC LIMIT ?`,
  ).bind(targetType, targetId, limit).all<ArtifactRow>();
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows.results ?? []) {
    throwIfAborted(signal);
    await env.R2.delete(row.object_key);
    throwIfAborted(signal);
    await env.DB.prepare(
      `UPDATE static_artifacts SET deleted_at = ?
       WHERE target_type = ? AND target_id = ? AND object_key = ? AND deleted_at IS NULL`,
    ).bind(now, targetType, targetId, row.object_key).run();
    throwIfAborted(signal);
  }
  return rows.results?.length ?? 0;
}

async function reconcileTrackedArtifacts(
  env: Env,
  target: ArtifactTarget,
  liveKeys: readonly string[],
  limit = 20,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  const rows = await env.DB.prepare(
    `SELECT object_key FROM static_artifacts
     WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
       AND object_key NOT IN (${liveKeys.length ? liveKeys.map(() => "?").join(",") : "NULL"})
     ORDER BY generated_at ASC LIMIT ?`,
  ).bind(target.targetType, target.targetId, ...liveKeys, limit).all<ArtifactRow>();
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows.results ?? []) {
    throwIfAborted(signal);
    await env.R2.delete(row.object_key);
    throwIfAborted(signal);
    await env.DB.prepare(
      `UPDATE static_artifacts SET deleted_at = ?
       WHERE target_type = ? AND target_id = ? AND object_key = ? AND deleted_at IS NULL`,
    ).bind(now, target.targetType, target.targetId, row.object_key).run();
    throwIfAborted(signal);
  }
}

async function loadActivePublicEventItemsForTopHero(
  env: Env,
  now: number,
  signal?: RebuildSignal,
): Promise<Record<string, unknown>[]> {
  const activeEvents = await env.DB.prepare(
    `SELECT ${EVENT_INDEX_COLUMNS}
     FROM events
     WHERE visibility_status = 'public'
       AND ${NON_POINT_EVENT_PERIOD_SQL}
       AND (
         (CASE
            WHEN end_time IS NOT NULL THEN end_time
            WHEN start_time IS NOT NULL THEN start_time
            ELSE NULL
          END) IS NULL
         OR (CASE
            WHEN end_time IS NOT NULL THEN end_time
            WHEN start_time IS NOT NULL THEN start_time
            ELSE NULL
          END) > ?
       )
     ORDER BY start_time DESC
     LIMIT 30`,
  ).bind(now).all<Record<string, unknown>>();
  throwIfAborted(signal);
  return activeEvents.results ?? [];
}

async function loadHeroEventSlotStats(
  env: Env,
  activeEventItems: readonly Record<string, unknown>[],
  signal?: RebuildSignal,
): Promise<{ event_id: string; available: number; total: number }[]> {
  const heroEventIds = pickHeroEvents(activeEventItems as HeroEventRow[]).map((event) =>
    String(event.id ?? "").trim(),
  ).filter(Boolean);
  const heroSlotStatsSql = buildHeroEventSlotStatsSql(heroEventIds);
  const slotStats = heroSlotStatsSql
    ? await env.DB.prepare(heroSlotStatsSql).bind(...heroEventIds).all()
    : { results: [] as { event_id: string; available: number; total: number }[] };
  throwIfAborted(signal);
  return slotStats.results ?? [];
}

type HeroEventSlotStatRow = { event_id: string; available: number; total: number };

async function putTopSlotStatsArtifact(
  env: Env,
  items: readonly HeroEventSlotStatRow[],
  generatedAt: number,
  signal?: RebuildSignal,
): Promise<void> {
  const payload = {
    schema_version: TOP_SLOT_STATS_SCHEMA_VERSION,
    generated_at: generatedAt,
    items,
  };
  const byteLength = topSlotStatsArtifactByteLength(payload);
  if (byteLength > TOP_SLOT_STATS_MAX_OBJECT_BYTES) {
    throw new Error(
      `${TOP_SLOT_STATS_OBJECT_KEY} exceeds size limit (${byteLength} > ${TOP_SLOT_STATS_MAX_OBJECT_BYTES} bytes)`,
    );
  }
  throwIfAborted(signal);
  await putJson(
    env,
    TOP_SLOT_STATS_OBJECT_KEY,
    payload,
    staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.topSlotStats),
    { targetType: "top_slot_stats", targetId: "global" },
    signal,
  );
}

async function rebuildTopSlotStats(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const activeEventItems = await loadActivePublicEventItemsForTopHero(env, now, signal);
  const items = await loadHeroEventSlotStats(env, activeEventItems, signal);
  await putTopSlotStatsArtifact(env, items, now, signal);
}

async function putTopSectionArtifact(
  env: Env,
  targetType: string,
  objectKey: string,
  body: unknown,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  await putJson(
    env,
    objectKey,
    body,
    staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.top),
    { targetType, targetId: "global" },
    signal,
  );
}

async function loadTopNostalgicPool(
  env: Env,
  nostalgiaCutoff: number,
  signal?: RebuildSignal,
): Promise<Record<string, unknown>[]> {
  throwIfAborted(signal);
  const nostalgic = await env.DB.prepare(
    `SELECT ${TOP_PUBLIC_VIDEO_SELECT}
     FROM videos AS v
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       AND v.scheduled_time IS NOT NULL
       AND v.scheduled_time <= ?
       AND ${YOUTUBE_SYNCED_PLAYABLE_SQL}
     -- RANDOM() is intentional here: limiting an oldest-first result would
     -- permanently exclude eligible videos after the first 200. SQLite
     -- samples the complete eligible set before applying the pool limit,
     -- allowing every eligible work to enter the daily display over time.
     ORDER BY RANDOM()
     LIMIT ${TOP_NOSTALGIA_POOL}`,
  ).bind(nostalgiaCutoff).all();
  throwIfAborted(signal);
  return nostalgic.results ?? [];
}

async function rehydrateTopNostalgicVideosById(
  env: Env,
  ids: readonly string[],
  nostalgiaCutoff: number,
  signal?: RebuildSignal,
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  throwIfAborted(signal);
  const rows = await env.DB.prepare(
    `SELECT ${TOP_PUBLIC_VIDEO_SELECT}
     FROM videos AS v
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       AND v.scheduled_time IS NOT NULL
       AND v.scheduled_time <= ?
       AND ${YOUTUBE_SYNCED_PLAYABLE_SQL}
       AND v.id IN (
         SELECT CAST(value AS TEXT)
         FROM json_each(?)
       )`,
  ).bind(nostalgiaCutoff, JSON.stringify(ids)).all();
  throwIfAborted(signal);
  return rows.results ?? [];
}

async function rebuildTopRecommended(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const recommended = await env.DB.prepare(
    `SELECT ${TOP_PUBLIC_VIDEO_SELECT}
     FROM videos AS v
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
     ORDER BY COALESCE(score, 0) DESC, scheduled_time DESC
     LIMIT 40`,
  ).all();
  throwIfAborted(signal);
  await putTopSectionArtifact(
    env,
    "top_recommended",
    TOP_RECOMMENDED_OBJECT_KEY,
    {
      schema_version: TOP_SECTIONS_SCHEMA_VERSION,
      generated_at: now,
      items: recommended.results ?? [],
    },
    signal,
  );
}

async function rebuildTopLatest(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const latest = await env.DB.prepare(
    `SELECT ${TOP_PUBLIC_VIDEO_SELECT}
     FROM videos AS v
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
     ORDER BY scheduled_time DESC
     LIMIT ${TOP_LATEST_LIMIT}`,
  ).all();
  throwIfAborted(signal);
  await putTopSectionArtifact(
    env,
    "top_latest",
    TOP_LATEST_OBJECT_KEY,
    {
      schema_version: TOP_SECTIONS_SCHEMA_VERSION,
      generated_at: now,
      items: latest.results ?? [],
    },
    signal,
  );
}

async function rebuildTopNostalgic(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const nostalgiaCutoff = unixYearsAgo(now, 3);
  const previousPayload = await loadWorkerR2Json(env, TOP_NOSTALGIC_OBJECT_KEY, signal);
  const previousRecord =
    previousPayload && typeof previousPayload === "object"
      ? previousPayload as Record<string, unknown>
      : null;
  const previousPoolSource = previousRecord?.pool;
  const previousDisplaySource = previousRecord?.display;
  const previousArtifactWithinBounds =
    Array.isArray(previousPoolSource) &&
    previousPoolSource.length <= TOP_NOSTALGIA_POOL &&
    Array.isArray(previousDisplaySource) &&
    previousDisplaySource.length <= TOP_NOSTALGIA_LIMIT;
  // 上限超過のR2 payloadはnormalize前に捨て、壊れたartifactによる過剰なCPU/D1誘発を防ぐ。
  const normalizedPrevious = previousArtifactWithinBounds
    ? normalizeTopNostalgicSection(previousPayload)
    : null;
  // normalizeVideoItems は不正行を捨てるため、要素数が変わった artifact は壊れた pool として扱う。
  const previousArtifactIsStable =
    normalizedPrevious != null &&
    Array.isArray(previousPoolSource) &&
    Array.isArray(previousDisplaySource) &&
    normalizedPrevious.pool.length === previousPoolSource.length &&
    normalizedPrevious.display.length === previousDisplaySource.length &&
    new Set(normalizedPrevious.pool.map((item) => String(item.id))).size ===
      normalizedPrevious.pool.length &&
    new Set(normalizedPrevious.display.map((item) => String(item.id))).size ===
      normalizedPrevious.display.length &&
    (normalizedPrevious.pool.length === 0
      ? normalizedPrevious.display.length === 0
      : normalizedPrevious.display.length > 0 &&
        normalizedPrevious.display.every((item) =>
          normalizedPrevious.pool.some((poolItem) => poolItem.id === item.id),
        ));
  const previous =
    previousArtifactIsStable &&
    normalizedPrevious.pool.length <= TOP_NOSTALGIA_POOL &&
    normalizedPrevious.display.length <= TOP_NOSTALGIA_LIMIT
      ? normalizedPrevious
      : null;
  const previousSelection = previous
    ? {
        displayIds: previous.display.map((item) => String(item.id)),
        selectionDay: previous.selectionDay,
        shuffledAt: previous.shuffledAt,
      }
    : null;
  const sameDay = previousSelection?.selectionDay === jstDayKey(now);
  const previousPoolIds = sameDay
    ? previous?.pool.map((item) => String(item.id)) ?? []
    : [];
  const previousCandidateIds = sameDay
    ? [...new Set([
        ...previousPoolIds,
        ...(previousSelection?.displayIds ?? []),
      ])]
    : [];
  const rehydratedRows = sameDay
    ? await rehydrateTopNostalgicVideosById(
        env,
        previousCandidateIds,
        nostalgiaCutoff,
        signal,
      )
    : [];
  const rehydratedById = new Map(
    rehydratedRows.map((row) => [String(row.id ?? ""), row]),
  );
  // 同日中は既存 pool をD1で再検証するだけで、ORDER BY RANDOM()を実行しない。
  const nostalgicPool = sameDay
    ? previousPoolIds
        .map((id) => rehydratedById.get(id))
        .filter((row): row is Record<string, unknown> => row != null)
    : await loadTopNostalgicPool(env, nostalgiaCutoff, signal);
  const rehydratedDisplay = sameDay
    ? (previousSelection?.displayIds ?? [])
        .map((id) => rehydratedById.get(id))
        .filter((row): row is Record<string, unknown> => row != null)
    : [];
  const selection = resolveNostalgicDisplaySelection({
    pool: nostalgicPool.map((row) => ({
      ...row,
      id: String(row.id ?? ""),
    })),
    previous: previousSelection,
    now,
    limit: TOP_NOSTALGIA_LIMIT,
    rehydrateById: () =>
      rehydratedDisplay.map((row) => ({
        ...row,
        id: String(row.id ?? ""),
      })),
  });
  throwIfAborted(signal);
  await putTopSectionArtifact(
    env,
    "top_nostalgic",
    TOP_NOSTALGIC_OBJECT_KEY,
    {
      schema_version: TOP_SECTIONS_SCHEMA_VERSION,
      generated_at: now,
      pool: nostalgicPool,
      display: selection.display,
      shuffled_at: selection.shuffledAt,
      selection_day: selection.selectionDay,
    },
    signal,
  );
  if (selection.isNewDaySelection) {
    throwIfAborted(signal);
    await env.KV.put(TOP_NOSTALGIC_SHUFFLE_DAY_KV_KEY, selection.selectionDay);
  }
}

async function rebuildTopEvents(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const [activeEventItems, latestEvents] = await Promise.all([
    loadActivePublicEventItemsForTopHero(env, now, signal),
    env.DB.prepare(
      `SELECT ${EVENT_INDEX_COLUMNS}
       FROM events
       WHERE visibility_status = 'public'
         AND ${NON_POINT_EVENT_PERIOD_SQL}
       ORDER BY start_time DESC
       LIMIT 12`,
    ).all<Record<string, unknown>>(),
  ]);
  throwIfAborted(signal);
  await putTopSectionArtifact(
    env,
    "top_events",
    TOP_EVENTS_OBJECT_KEY,
    {
      schema_version: TOP_SECTIONS_SCHEMA_VERSION,
      generated_at: now,
      active_events: activeEventItems,
      latest_events: latestEvents.results ?? [],
    },
    signal,
  );
}

async function rebuildTopAnnouncements(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const announcements = await env.DB.prepare(
    `SELECT id, title, body, severity, publish_at, expire_at
     FROM announcements
     WHERE is_published = 1
       AND target_audience = 'all'
       AND (publish_at IS NULL OR publish_at <= ?)
       AND (expire_at IS NULL OR expire_at > ?)
     ORDER BY publish_at DESC, updated_at DESC
     LIMIT 3`,
  ).bind(now, now).all();
  throwIfAborted(signal);
  await putTopSectionArtifact(
    env,
    "top_announcements",
    TOP_ANNOUNCEMENTS_OBJECT_KEY,
    {
      schema_version: TOP_SECTIONS_SCHEMA_VERSION,
      generated_at: now,
      items: announcements.results ?? [],
    },
    signal,
  );
}

async function rebuildTopStats(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const activeEventItems = await loadActivePublicEventItemsForTopHero(env, now, signal);
  const [publicVideoCount, creatorCount, publicEventCount] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM videos AS v
       WHERE v.visibility_status = 'public'
         AND COALESCE(v.primary_event_id, '') <> ?
         AND NOT EXISTS (
           SELECT 1 FROM video_events AS pvsf_summary_video_events
           WHERE pvsf_summary_video_events.video_id = v.id
             AND pvsf_summary_video_events.event_id = ?
         )`,
    )
      .bind(PVSF_SUMMARY_EVENT_ID, PVSF_SUMMARY_EVENT_ID)
      .first<{ c?: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM x_users
       WHERE approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})`,
    ).first<{ c?: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM events
       WHERE visibility_status = 'public'`,
    ).first<{ c?: number }>(),
  ]);
  throwIfAborted(signal);
  const creators = await resolvePickupCreatorsWithFallback(env, 30, "rebuildTopStats", signal);
  await putTopSectionArtifact(
    env,
    "top_stats",
    TOP_STATS_OBJECT_KEY,
    {
      schema_version: TOP_SECTIONS_SCHEMA_VERSION,
      generated_at: now,
      stats: {
        public_videos: Number(publicVideoCount?.c ?? 0),
        active_events: activeEventItems.length,
        public_events: Number(publicEventCount?.c ?? 0),
        creators: Number(creatorCount?.c ?? creators.length ?? 0),
      },
    },
    signal,
  );
}

async function loadRequiredTopSection<T>(
  env: Env,
  objectKey: string,
  normalize: (value: unknown) => T | null,
  label: string,
  signal?: RebuildSignal,
): Promise<T> {
  const payload = await loadWorkerR2Json(env, objectKey, signal);
  const normalized = normalize(payload);
  if (!normalized) {
    throw new Error(`top_composer_required_section_missing:${label}`);
  }
  return normalized;
}

async function rebuildTop(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const [
    recommendedSection,
    latestSection,
    nostalgicSection,
    eventsSection,
    announcementsSection,
    statsSection,
    slotStatsPayload,
    creators,
  ] = await Promise.all([
    loadRequiredTopSection(
      env,
      TOP_RECOMMENDED_OBJECT_KEY,
      normalizeTopRecommendedSection,
      "recommended",
      signal,
    ),
    loadRequiredTopSection(
      env,
      TOP_LATEST_OBJECT_KEY,
      normalizeTopLatestSection,
      "latest",
      signal,
    ),
    loadRequiredTopSection(
      env,
      TOP_NOSTALGIC_OBJECT_KEY,
      normalizeTopNostalgicSection,
      "nostalgic",
      signal,
    ),
    loadRequiredTopSection(
      env,
      TOP_EVENTS_OBJECT_KEY,
      normalizeTopEventsSection,
      "events",
      signal,
    ),
    loadRequiredTopSection(
      env,
      TOP_ANNOUNCEMENTS_OBJECT_KEY,
      normalizeTopAnnouncementsSection,
      "announcements",
      signal,
    ),
    loadRequiredTopSection(
      env,
      TOP_STATS_OBJECT_KEY,
      normalizeTopStatsSection,
      "stats",
      signal,
    ),
    loadWorkerR2Json(env, TOP_SLOT_STATS_OBJECT_KEY, signal),
    resolvePickupCreatorsWithFallback(env, 30, "rebuildTop", signal),
  ]);
  const slotStats = normalizeStaticTopSlotStats(slotStatsPayload);
  if (!slotStats) {
    throw new Error("top_composer_required_section_missing:slot_stats");
  }
  const slotStatsItems = [...slotStats.items.entries()].map(([event_id, stats]) => ({
    event_id,
    available: stats.available,
    total: stats.total,
  }));
  throwIfAborted(signal);
  const payload = {
    generated_at: now,
    recommended: recommendedSection.items,
    latest: latestSection.items,
    nostalgic_pool: nostalgicSection.pool,
    nostalgic: nostalgicSection.display,
    nostalgic_shuffled_at: nostalgicSection.shuffledAt,
    items: latestSection.items,
    active_events: eventsSection.activeEvents,
    latest_events: eventsSection.latestEvents,
    creators,
    announcements: announcementsSection.items,
    slot_stats: slotStatsItems,
    stats: statsSection.stats,
  };
  throwIfAborted(signal);
  await putJson(
    env,
    "top.json",
    payload,
    staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.top),
    { targetType: "top", targetId: "global" },
    signal,
  );
  throwIfAborted(signal);
}

/**
 * JST 日次で top_nostalgic 再生成をキュー登録する。
 * 日次マーカーは rebuildTopNostalgic の新日付抽選成功時だけ更新する。
 */
export async function ensureDailyTopNostalgicShuffle(
  env: Env,
  signal?: RebuildSignal,
): Promise<number> {
  try {
    throwIfAborted(signal);
    const now = Math.floor(Date.now() / 1000);
    const dayKey = jstDayKey(now);
    const lastDay = await env.KV.get(TOP_NOSTALGIC_SHUFFLE_DAY_KV_KEY);
    if (lastDay === dayKey) {
      return 0;
    }

    const enqueued = await enqueueTopSectionRebuild(
      env,
      "top_nostalgic",
      "nostalgic_daily_shuffle",
      "normal",
      signal,
    );
    if (enqueued > 0) {
      return 1;
    }
    return 0;
  } catch (error) {
    console.error("[ensureDailyTopNostalgicShuffle] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

async function rebuildListRecent(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const rows = await env.DB.prepare(
    `SELECT v.id, v.title, v.youtube_video_id,
            v.creator_display_name AS display_name,
            v.creator_display_name,
            v.creator_x_user_id,
            v.creator_icon_url AS icon_url,
            v.creator_icon_url,
            e.id AS primary_event_id,
            e.title AS primary_event_title,
            v.scheduled_time,
            v.visibility_status AS status
   FROM videos v
   LEFT JOIN events e
     ON e.id = v.primary_event_id AND e.visibility_status = 'public'
   WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
   ORDER BY v.scheduled_time DESC
   LIMIT ?`,
  )
    .bind(RECENT_LIST_LIMIT)
    .all();
  throwIfAborted(signal);
  const items = rows.results ?? [];
  const payload = {
    generated_at: Math.floor(Date.now() / 1000),
    total: capStaticListTotal(items.length, items),
    items,
  };
  assertStaticListObjectSize("list/recent.json", payload);
  await putJson(env, "list/recent.json", payload, staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.listRecent), { targetType: "list_recent", targetId: "global" }, signal);
}

async function rebuildListPopular(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const rows = await env.DB.prepare(
    `SELECT ${STATIC_LIST_VIDEO_SELECT}
     ${STATIC_LIST_VIDEO_FROM}
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
     ORDER BY COALESCE(v.score, 0) DESC, v.scheduled_time DESC
     LIMIT ?`,
  )
    .bind(POPULAR_LIST_LIMIT)
    .all();
  throwIfAborted(signal);
  const items = rows.results ?? [];
  const payload = {
    generated_at: Math.floor(Date.now() / 1000),
    total: capStaticListTotal(items.length, items),
    items,
  };
  assertStaticListObjectSize("list/popular.json", payload);
  await putJson(env, "list/popular.json", payload, staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.listPopular), { targetType: "list_popular", targetId: "global" }, signal);
}

async function rebuildEventsIndex(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const [rowsResult, groupSections] = await Promise.all([
    env.DB.prepare(
      `SELECT ${EVENT_INDEX_COLUMNS}
       FROM events
       WHERE visibility_status = 'public'
         AND ${NON_POINT_EVENT_PERIOD_SQL}
       ORDER BY start_time DESC
       LIMIT ?`,
    ).bind(EVENTS_INDEX_MAX_ROWS).all<Record<string, unknown>>(),
    rebuildEventGroupSections(env, signal),
  ]);

  throwIfAborted(signal);
  const items = await attachPublicOperatorNames(
    env,
    rowsResult.results ?? [],
    signal,
  );

  throwIfAborted(signal);
  await putJson(
    env,
    "events/index.json",
    {
      generated_at: Math.floor(Date.now() / 1000),
      items,
      group_sections: groupSections,
    },
    "public, max-age=300, stale-while-revalidate=1800",
    {
      targetType: "events_index",
      targetId: "global",
    },
    signal,
  );
}

async function rebuildEventGroupSections(env: Env, signal?: RebuildSignal): Promise<unknown[]> {
  throwIfAborted(signal);
  const groups = await env.DB.prepare(
    `SELECT id, slug, name, description, group_type, icon_url, accent_color, sort_order
     FROM event_groups
     WHERE visibility_status = 'public'
     ORDER BY sort_order ASC, name ASC
     LIMIT ?`,
  ).bind(EVENT_GROUP_MAX_ROWS).all<Record<string, unknown>>();
  throwIfAborted(signal);
  const groupRows = groups.results ?? [];
  if (groupRows.length === 0) return [];

  const groupIds = groupRows
    .map((group) => String(group.id ?? "").trim())
    .filter(Boolean);
  if (groupIds.length === 0) return [];

  const placeholders = groupIds.map(() => "?").join(",");
  const eventsByGroup = new Map<string, Record<string, unknown>[]>();

  const eventColumns = EVENT_INDEX_COLUMNS
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  const junctionRows = await env.DB.prepare(
    `WITH ranked_group_events AS (
       SELECT ege.event_group_id AS group_id,
              ${eventColumns.map((column) => `e.${column} AS ${column}`).join(", ")},
              ROW_NUMBER() OVER (
                PARTITION BY ege.event_group_id
                ORDER BY e.start_time DESC, e.created_at DESC, e.id ASC
              ) AS group_rank
       FROM event_group_events ege
       INNER JOIN events e ON e.id = ege.event_id
       WHERE ege.event_group_id IN (${placeholders})
         AND e.visibility_status = 'public'
         AND ${NON_POINT_EVENT_PERIOD_SQL}
     )
     SELECT group_id, ${eventColumns.join(", ")}
     FROM ranked_group_events
     WHERE group_rank <= ?
     ORDER BY group_id ASC, start_time DESC, created_at DESC, id ASC
     LIMIT ?`,
  )
    .bind(
      ...groupIds,
      EVENT_GROUP_EVENT_MAX_PER_GROUP,
      EVENT_GROUP_EVENT_MAX_ROWS,
    )
    .all<Record<string, unknown>>();
  throwIfAborted(signal);
  const enrichedRows = await attachPublicOperatorNames(
    env,
    junctionRows.results ?? [],
    signal,
  );

  for (const row of enrichedRows) {
    mergeGroupEvent(
      eventsByGroup,
      row.group_id,
      stripGroupId(row),
    );
  }

  return groupRows.map((group) => {
    const id = String(group.id ?? "");
    const events = eventsByGroup.get(id) ?? [];
    return {
      ...group,
      sort_order: normalizeNumber(group.sort_order) ?? 0,
      latest_event_start_time: latestEventStart(events),
      events,
    };
  });
}

function mergeGroupEvent(
  target: Map<string, Record<string, unknown>[]>,
  rawGroupId: unknown,
  event: Record<string, unknown>,
): void {
  const groupId = String(rawGroupId ?? "").trim();
  const eventId = String(event.id ?? "").trim();
  if (!groupId || !eventId) return;
  const current = target.get(groupId) ?? [];
  if (current.some((row) => row.id === eventId)) return;
  current.push(event);
  target.set(groupId, current);
}

async function attachPublicOperatorNames(
  env: Env,
  rows: readonly Record<string, unknown>[],
  signal?: RebuildSignal,
): Promise<Record<string, unknown>[]> {
  throwIfAborted(signal);
  const eventIds = Array.from(
    new Set(
      rows
        .map((row) => String(row.id ?? "").trim())
        .filter(Boolean),
    ),
  );

  if (eventIds.length === 0) {
    return rows.map((row) => ({
      ...row,
      public_operator_names: [],
    }));
  }

  const namesByEvent = new Map<string, string[]>();

  for (
    let offset = 0;
    offset < eventIds.length;
    offset += PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE
  ) {
    throwIfAborted(signal);
    const eventIdChunk = eventIds.slice(
      offset,
      offset + PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE,
    );
    const placeholders = eventIdChunk.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `WITH ranked_public_staff AS (
         SELECT event_id, display_name,
                ROW_NUMBER() OVER (
                  PARTITION BY event_id
                  ORDER BY created_at ASC, id ASC
                ) AS staff_rank
         FROM event_staff
         WHERE is_public = 1
           AND event_id IN (${placeholders})
       )
       SELECT event_id, display_name
       FROM ranked_public_staff
       WHERE staff_rank <= ?
       ORDER BY event_id ASC, staff_rank ASC`,
    )
      .bind(...eventIdChunk, PUBLIC_STAFF_MAX_PER_EVENT)
      .all<{
        event_id: string;
        display_name: string;
      }>();
    throwIfAborted(signal);

    for (const staff of result.results ?? []) {
      const eventId = String(staff.event_id ?? "").trim();
      const displayName = String(staff.display_name ?? "").trim();
      if (!eventId || !displayName) continue;

      const names = namesByEvent.get(eventId) ?? [];
      if (!names.includes(displayName)) {
        names.push(displayName);
      }
      namesByEvent.set(eventId, names);
    }
  }

  return rows.map((row) => {
    const eventId = String(row.id ?? "").trim();
    return {
      ...row,
      public_operator_names:
        namesByEvent.get(eventId) ?? [],
    };
  });
}

function stripGroupId(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const { group_id: _groupId, ...event } = row;
  return event;
}

function normalizeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function latestEventStart(events: readonly Record<string, unknown>[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    const start = normalizeNumber(event.start_time);
    if (start == null) continue;
    if (latest == null || start > latest) latest = start;
  }
  return latest;
}

async function rebuildSearchIndexLite(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const videos = await env.DB.prepare(
    `SELECT id, title, creator_display_name, creator_x_user_id, youtube_video_id
     FROM videos AS v
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
     ORDER BY v.updated_at DESC
     LIMIT ?`,
  )
    .bind(SEARCH_INDEX_VIDEO_LIMIT)
    .all();
  const users = await env.DB.prepare(
    `SELECT id, x_name FROM x_users
     WHERE approval_status = 'approved'
     ORDER BY id ASC LIMIT 500`,
  ).all();
  throwIfAborted(signal);
  const payload = {
    generated_at: Math.floor(Date.now() / 1000),
    videos: videos.results ?? [],
    users: users.results ?? [],
  };
  assertStaticListObjectSize("search-index-lite.json", payload);
  await putJson(env, "search-index-lite.json", payload, staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.searchIndex), { targetType: "search_index", targetId: "global" }, signal);
}

/**
 * 公開状態へ戻した entity は、成果物を正常に書き終えるまで manifest の
 * block を残す。成果物の成功後に D1 fence token を CAS 確認してから解除する
 * ことで、再公開と直後の非公開化が競合しても新しい block を消さない。
 */
async function releaseVisibilityFenceAfterRebuild(
  env: Env,
  entityType: PublicVisibilityFenceEntityType,
  entityId: string,
  signal?: RebuildSignal,
  sourceUpdatedAt?: number | null,
): Promise<void> {
  if (!env.R2 || typeof env.R2.get !== "function") return;
  throwIfAborted(signal);

  const fence = await env.DB.prepare(
    `SELECT fence_token, state
     FROM public_visibility_fences
     WHERE entity_type = ? AND entity_id = ?
     LIMIT 1`,
  )
    .bind(entityType, entityId)
    .first<{ fence_token?: string; state?: string }>();
  const fenceToken = String(fence?.fence_token ?? "").trim();
  if (fence?.state !== "release_pending" || !fenceToken) return;

  // Event composed output depends on two producer artifacts. Do not release
  // a promotion fence while either artifact is older than the current D1 row;
  // a concurrent composer could otherwise publish the previous public JSON.
  if (entityType === "event") {
    const currentEvent = await env.DB.prepare(
      `SELECT visibility_status, updated_at
       FROM events WHERE id = ? LIMIT 1`,
    )
      .bind(entityId)
      .first<{ visibility_status?: string; updated_at?: number }>();
    const currentUpdatedAt = Number(currentEvent?.updated_at ?? 0) || 0;
    const builtFrom = Number(sourceUpdatedAt ?? 0) || 0;
    if (
      currentEvent?.visibility_status !== "public" ||
      currentUpdatedAt <= 0 ||
      builtFrom < currentUpdatedAt
    ) {
      return;
    }

    const producerArtifacts = await env.DB.prepare(
      `SELECT target_type, source_updated_at
       FROM static_artifacts
       WHERE target_id = ?
         AND target_type IN ('event_base', 'event_slots')
         AND deleted_at IS NULL`,
    )
      .bind(entityId)
      .all<{ target_type?: string; source_updated_at?: number }>();
    const sourceByTarget = new Map(
      (producerArtifacts.results ?? []).map((row) => [
        String(row.target_type ?? ""),
        Number(row.source_updated_at ?? 0) || 0,
      ]),
    );
    if (
      (sourceByTarget.get("event_base") ?? 0) < currentUpdatedAt ||
      (sourceByTarget.get("event_slots") ?? 0) < currentUpdatedAt
    ) {
      return;
    }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfAborted(signal);
    const { manifest, etag } =
      await readWorkerVisibilityBlockedEntitiesManifest(env.R2);
    const entry = manifest.entities.find(
      (row) => row.entity_type === entityType && row.entity_id === entityId,
    );

    // 旧データには manifest entry がない場合がある。成果物が生成済みなら
    // fence だけ released にして、次回以降の再構築を不要にする。
    if (!entry) {
      await env.DB.prepare(
        `UPDATE public_visibility_fences
         SET state = 'released', updated_at = MAX(updated_at + 1, ?)
         WHERE entity_type = ? AND entity_id = ?
           AND state = 'release_pending' AND fence_token = ?`,
      )
        .bind(Math.floor(Date.now() / 1000), entityType, entityId, fenceToken)
        .run();
      return;
    }

    // 別の非公開化が先に manifest を更新した場合は、その新しい block を
    // 触らずに終了する。
    if (entry.fence_token !== fenceToken) return;
    const released = releaseBlockedEntityInManifest(
      manifest,
      entityType,
      entityId,
      fenceToken,
      Math.floor(Date.now() / 1000),
    );
    if (!released) return;
    try {
      await writeWorkerVisibilityBlockedEntitiesManifest(env.R2, released, etag);
    } catch (error) {
      if (attempt === 2) throw error;
      continue;
    }

    await env.DB.prepare(
      `UPDATE public_visibility_fences
       SET state = 'released', updated_at = MAX(updated_at + 1, ?)
       WHERE entity_type = ? AND entity_id = ?
         AND state = 'release_pending' AND fence_token = ?`,
    )
      .bind(Math.floor(Date.now() / 1000), entityType, entityId, fenceToken)
      .run();
    return;
  }
}

async function removeAllEventArtifacts(
  env: Env,
  eventId: string,
  signal?: RebuildSignal,
): Promise<void> {
  await removeTrackedArtifacts(env, "event", eventId, 20, signal);
  await removeTrackedArtifacts(env, "event_base", eventId, 20, signal);
  await removeTrackedArtifacts(env, "event_slots", eventId, 20, signal);
  // Older rows may have lost their static_artifacts bookkeeping. Delete the
  // canonical keys explicitly so an old event ID cannot remain reachable just
  // because its tracking row is missing.
  for (const key of [
    `events/${eventId}.json`,
    eventBaseObjectKey(eventId),
    eventSlotsObjectKey(eventId),
  ]) {
    throwIfAborted(signal);
    await env.R2.delete(key);
  }
}

function eventBaseObjectKey(eventId: string): string {
  return `events/${eventId}/base.v1.json`;
}

function eventSlotsObjectKey(eventId: string): string {
  return `events/${eventId}/slots.v1.json`;
}

function buildEventSlotsSummary(
  slots: readonly Record<string, unknown>[],
): Array<{ status: string; c: number }> {
  const counts = new Map<string, number>();
  for (const slot of slots) {
    const status = String(slot.status ?? "");
    if (!status) continue;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, c]) => ({ status, c }));
}

async function loadEventVisibilityRow(
  env: Env,
  eventId: string,
  signal?: RebuildSignal,
): Promise<Record<string, unknown> | null> {
  throwIfAborted(signal);
  return (
    (await env.DB.prepare(
      `SELECT id, visibility_status, updated_at,
              start_time, end_time
       FROM events WHERE id = ? LIMIT 1`,
    )
      .bind(eventId)
      .first()) ?? null
  );
}

async function rebuildEventBase(
  env: Env,
  eventId: string,
  signal?: RebuildSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  const eventRow = (
    await env.DB.prepare(
      `SELECT ${EVENT_DETAIL_COLUMNS}
       FROM events WHERE id = ? LIMIT 1`,
    )
      .bind(eventId)
      .first()
  ) as Record<string, unknown> | null;
  throwIfAborted(signal);
  if (!eventRow || String(eventRow.visibility_status ?? "") !== "public") {
    await removeAllEventArtifacts(env, eventId, signal);
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const freshness = resolveEventFreshness(
    {
      visibility_status: (eventRow.visibility_status as string | null) ?? null,
      start_time: (eventRow.start_time as number | null) ?? null,
      end_time: (eventRow.end_time as number | null) ?? null,
    },
    now,
  );
  const eventVideoWhere = eventPublicVideoWhereSql("v");

  const [staff, publicVideos, creatorCountRow] = await Promise.all([
    env.DB.prepare(
      `SELECT es.display_name, es.public_role_label,
              xu.id AS x_user_id, xu.x_name, xu.icon_url,
              CASE
                WHEN xu.approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})
                THEN 1
                ELSE 0
              END AS has_public_profile
       FROM event_staff AS es
       LEFT JOIN x_users AS xu ON xu.id = es.x_user_id
       WHERE es.event_id = ? AND es.is_public = 1
       ORDER BY es.created_at ASC, es.id ASC`,
    )
      .bind(eventId)
      .all(),
    env.DB.prepare(
      `SELECT v.id, v.title, v.youtube_video_id, v.creator_display_name,
              v.creator_x_user_id, v.creator_icon_url, v.visibility_status,
              v.scheduled_time, v.part, COALESCE(v.score, 0) AS score
       FROM videos AS v
       WHERE ${eventVideoWhere}
       ORDER BY v.scheduled_time ASC, v.id ASC
       LIMIT 501`,
    )
      .bind(eventId, eventId)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM (
         SELECT LOWER(v.creator_x_user_id) AS x_id
         FROM videos AS v
         WHERE ${eventVideoWhere}
           AND v.creator_x_user_id IS NOT NULL
         UNION
         SELECT LOWER(vm.x_user_id) AS x_id
         FROM video_members AS vm
         INNER JOIN videos AS v ON v.id = vm.video_id
         WHERE ${eventVideoWhere}
           AND vm.is_public_member = 1
           AND vm.x_user_id IS NOT NULL
       )`,
    )
      .bind(eventId, eventId, eventId, eventId)
      .first<{ c?: number }>(),
  ]);

  throwIfAborted(signal);
  const videoRows = publicVideos.results ?? [];
  const hasOverflow = videoRows.length > 500;
  const listedVideos = hasOverflow ? videoRows.slice(0, 500) : videoRows;
  let videoTotal = listedVideos.length;
  if (hasOverflow) {
    const videoTotalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM videos AS v
       WHERE ${eventVideoWhere}`,
    )
      .bind(eventId, eventId)
      .first<{ c?: number }>();
    throwIfAborted(signal);
    videoTotal = Number(videoTotalRow?.c ?? listedVideos.length);
  }

  const objectKey = eventBaseObjectKey(eventId);
  const payload = {
    generated_at: now,
    freshness,
    event: eventRow,
    public_staff: staff.results ?? [],
    public_videos: listedVideos,
    video_total: videoTotal,
    creator_count: Number(creatorCountRow?.c ?? 0),
  };

  await putJson(
    env,
    objectKey,
    payload,
    cacheControlForFreshness(freshness),
    {
      targetType: "event_base",
      targetId: eventId,
      sourceUpdatedAt: Number(eventRow.updated_at ?? 0) || null,
    },
    signal,
  );
  await reconcileTrackedArtifacts(
    env,
    { targetType: "event_base", targetId: eventId },
    [objectKey],
    20,
    signal,
  );
  return true;
}

async function rebuildEventSlots(
  env: Env,
  eventId: string,
  signal?: RebuildSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  const ev = await loadEventVisibilityRow(env, eventId, signal);
  throwIfAborted(signal);
  if (!ev || String(ev.visibility_status ?? "") !== "public") {
    await removeAllEventArtifacts(env, eventId, signal);
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const publicSlots = await env.DB.prepare(
    `SELECT id, status, start_time, sort_order
     FROM slots
     WHERE event_id = ?
     ORDER BY start_time ASC, sort_order ASC, id ASC`,
  )
    .bind(eventId)
    .all();
  throwIfAborted(signal);
  const slots = (publicSlots.results ?? []) as Record<string, unknown>[];
  const objectKey = eventSlotsObjectKey(eventId);
  const payload = {
    generated_at: now,
    slots,
    slots_summary: buildEventSlotsSummary(slots),
  };

  await putJson(
    env,
    objectKey,
    payload,
    staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.eventDetail),
    {
      targetType: "event_slots",
      targetId: eventId,
      sourceUpdatedAt: Number(ev.updated_at ?? 0) || null,
    },
    signal,
  );
  await reconcileTrackedArtifacts(
    env,
    { targetType: "event_slots", targetId: eventId },
    [objectKey],
    20,
    signal,
  );
  return true;
}

function stripEventPublicVideoScore(
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (!("score" in row)) return row;
  const { score: _score, ...rest } = row;
  return rest;
}

async function rebuildEvent(
  env: Env,
  eventId: string,
  signal?: RebuildSignal,
  reason?: string | null,
): Promise<void> {
  throwIfAborted(signal);
  const ev = await loadEventVisibilityRow(env, eventId, signal);
  throwIfAborted(signal);
  if (!ev || String(ev.visibility_status ?? "") !== "public") {
    await removeAllEventArtifacts(env, eventId, signal);
    // An old event ID is deliberately kept blocked after a successful rename.
    // Removing its canonical artifacts is safe; releasing the tombstone would
    // allow a stale cache/object (or a future ID reuse) to become public again.
    return;
  }

  const baseKey = eventBaseObjectKey(eventId);
  const slotsKey = eventSlotsObjectKey(eventId);
  const [basePayload, slotsPayload] = await Promise.all([
    loadWorkerR2Json(env, baseKey, signal),
    loadWorkerR2Json(env, slotsKey, signal),
  ]);
  throwIfAborted(signal);
  if (!basePayload || typeof basePayload !== "object") {
    throw new Error("event_composer_required_section_missing:base");
  }
  if (!slotsPayload || typeof slotsPayload !== "object") {
    throw new Error("event_composer_required_section_missing:slots");
  }
  const base = basePayload as Record<string, unknown>;
  const slots = slotsPayload as Record<string, unknown>;
  if (!base.event || typeof base.event !== "object") {
    throw new Error("event_composer_required_section_missing:base");
  }
  if (!Array.isArray(slots.slots) || !Array.isArray(slots.slots_summary)) {
    throw new Error("event_composer_required_section_missing:slots");
  }

  const now = Math.floor(Date.now() / 1000);
  const freshness = resolveEventFreshness(
    {
      visibility_status: (ev.visibility_status as string | null) ?? null,
      start_time: (ev.start_time as number | null) ?? null,
      end_time: (ev.end_time as number | null) ?? null,
    },
    now,
  );
  const payload = {
    generated_at: now,
    freshness,
    event: base.event,
    public_staff: Array.isArray(base.public_staff) ? base.public_staff : [],
    slots_summary: slots.slots_summary,
    slots: slots.slots,
    public_videos: Array.isArray(base.public_videos)
      ? base.public_videos.map((row) =>
          stripEventPublicVideoScore(row as Record<string, unknown>),
        )
      : [],
    video_total: Number(base.video_total ?? 0),
    creator_count: Number(base.creator_count ?? 0),
  };

  await putJson(
    env,
    `events/${eventId}.json`,
    payload,
    cacheControlForFreshness(freshness),
    {
      targetType: "event",
      targetId: eventId,
      sourceUpdatedAt: Number(ev.updated_at ?? 0) || null,
    },
    signal,
  );
  await reconcileTrackedArtifacts(
    env,
    { targetType: "event", targetId: eventId },
    [`events/${eventId}.json`],
    20,
    signal,
  );
  await releaseVisibilityFenceAfterRebuild(
    env,
    "event",
    eventId,
    signal,
    Number(ev.updated_at ?? 0) || null,
  );
}

type StaticRelatedVideoRow = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  creator_x_user_id: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
  video_score: number | null;
  member_x_user_id: string | null;
};

type StaticRelatedVideoSelection = {
  primary: StaticRelatedVideo[];
  reserve: StaticRelatedVideo[];
};

const STATIC_RELATED_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  v.creator_display_name AS display_name,
  v.creator_icon_url AS icon_url,
  v.creator_x_user_id,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  v.scheduled_time,
  COALESCE(v.score, 0) AS video_score
`;

function normalizeStaticRelatedRow(
  row: Record<string, unknown>,
): StaticRelatedVideoRow | null {
  const id = String(row.id ?? "").trim();
  const title = String(row.title ?? "").trim();
  const displayName = String(row.display_name ?? "").trim();
  if (!id || !title || !displayName) return null;
  return {
    id,
    title,
    youtube_video_id:
      row.youtube_video_id == null ? null : String(row.youtube_video_id),
    display_name: displayName,
    icon_url: row.icon_url == null ? null : String(row.icon_url),
    creator_x_user_id:
      row.creator_x_user_id == null ? null : String(row.creator_x_user_id),
    primary_event_id:
      row.primary_event_id == null ? null : String(row.primary_event_id),
    scheduled_time:
      row.scheduled_time == null ? null : Number(row.scheduled_time),
    video_score: row.video_score == null ? null : Number(row.video_score),
    member_x_user_id:
      row.member_x_user_id == null
        ? null
        : String(row.member_x_user_id).trim().toLowerCase() || null,
  };
}

function toPublicRelatedVideoCard(
  row: StaticRelatedVideoRow,
): StaticRelatedVideo {
  return {
    id: row.id,
    title: row.title,
    youtube_video_id: row.youtube_video_id,
    display_name: row.display_name,
    icon_url: row.icon_url,
    creator_x_user_id: row.creator_x_user_id,
    primary_event_id: row.primary_event_id,
    scheduled_time: row.scheduled_time,
  };
}

async function fetchStaticRelatedVideos(
  env: Env,
  current: {
    id: string;
    creator_x_user_id: string | null;
    primary_event_id: string | null;
    scheduled_time: number | null;
    eventIds: string[];
    memberXUserIds: string[];
  },
  signal?: RebuildSignal,
): Promise<StaticRelatedVideoSelection> {
  throwIfAborted(signal);
  const relatedLimit = clampRelatedLimit(RELATED_DEFAULT_LIMIT);
  const minTarget = Math.min(15, relatedLimit);
  const targetCount = relatedLimit + RELATED_RESERVE_LIMIT;
  const sameEventLimit = 5;
  const sameCreatorLimit = 4;
  const nearDateLimit = 4;
  const sharedLimit = 8;

  const baseWhere = `${COUNTABLE_PUBLIC_VIDEO_SQL} AND v.id <> ?`;
  const bindCurrent = (sql: string, ...extra: unknown[]) =>
    env.DB.prepare(sql).bind(current.id, ...extra);

  const mapRows = (rows: readonly Record<string, unknown>[]) =>
    rows
      .map(normalizeStaticRelatedRow)
      .filter((row): row is StaticRelatedVideoRow => row !== null);

  const scheduledTime = current.scheduled_time;
  const temporalPrevious =
    scheduledTime != null
      ? mapRows(
          (
            await bindCurrent(
              `SELECT ${STATIC_RELATED_VIDEO_SELECT}
               FROM videos AS v
               WHERE ${baseWhere}
                 AND v.scheduled_time IS NOT NULL
                 AND v.scheduled_time < ?
               ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC
               LIMIT 3`,
              scheduledTime,
            ).all()
          ).results ?? [],
        )
      : [];
  throwIfAborted(signal);

  const temporalNext =
    scheduledTime != null
      ? mapRows(
          (
            await bindCurrent(
              `SELECT ${STATIC_RELATED_VIDEO_SELECT}
               FROM videos AS v
               WHERE ${baseWhere}
                 AND v.scheduled_time IS NOT NULL
                 AND v.scheduled_time > ?
               ORDER BY v.scheduled_time ASC, COALESCE(v.score, 0) DESC
               LIMIT 3`,
              scheduledTime,
            ).all()
          ).results ?? [],
        )
      : [];
  throwIfAborted(signal);

  const eventIds = Array.from(
    new Set(
      [...current.eventIds, current.primary_event_id].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  const sameEvent =
    eventIds.length > 0
      ? uniqueByVideoId(
          mapRows(
            (
              await env.DB.prepare(
                `SELECT ${STATIC_RELATED_VIDEO_SELECT}
                 FROM videos AS v
                 WHERE ${baseWhere}
                   AND EXISTS (
                     SELECT 1
                     FROM video_events AS ve
                     WHERE ve.video_id = v.id
                       AND ve.event_id IN (
                         SELECT CAST(value AS TEXT)
                         FROM json_each(?)
                       )
                   )
                 ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC, v.id DESC
                 LIMIT ?`,
              )
                .bind(
                  current.id,
                  JSON.stringify(eventIds),
                  Math.min(24, sameEventLimit * 4),
                )
                .all()
            ).results ?? [],
          ),
        )
      : [];
  throwIfAborted(signal);

  const sameCreator = current.creator_x_user_id
    ? mapRows(
        (
          await bindCurrent(
            `SELECT ${STATIC_RELATED_VIDEO_SELECT}
             FROM videos AS v
             WHERE ${baseWhere}
               AND v.creator_x_user_id = ?
             ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC
             LIMIT ?`,
            current.creator_x_user_id,
            sameCreatorLimit,
          ).all()
        ).results ?? [],
      )
    : [];
  throwIfAborted(signal);

  const uniqueMemberXIds = Array.from(
    new Set(
      current.memberXUserIds
        .map((xId) => String(xId ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const memberLimit = perMemberLimit(uniqueMemberXIds.length);
  let sharedMembers: StaticRelatedVideoRow[] = [];
  if (uniqueMemberXIds.length > 0) {
    const sharedRows = mapRows(
      (
        await env.DB.prepare(
          `SELECT ${STATIC_RELATED_VIDEO_SELECT},
                  LOWER(vm.x_user_id) AS member_x_user_id
           FROM video_members AS vm
           INNER JOIN videos AS v ON v.id = vm.video_id
           WHERE ${baseWhere}
             AND vm.is_public_member = 1
             AND vm.x_user_id IS NOT NULL
             AND LOWER(vm.x_user_id) IN (
               SELECT LOWER(CAST(value AS TEXT))
               FROM json_each(?)
             )
           ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC, v.id DESC
           LIMIT 30`,
        )
          .bind(current.id, JSON.stringify(uniqueMemberXIds))
          .all()
      ).results ?? [],
    );
    const byMember = new Map<string, StaticRelatedVideoRow[]>();
    for (const row of sharedRows) {
      const memberId = row.member_x_user_id;
      if (!memberId) continue;
      const bucket = byMember.get(memberId) ?? [];
      if (!bucket.some((item) => item.id === row.id)) bucket.push(row);
      byMember.set(memberId, bucket);
    }
    const mixed: StaticRelatedVideoRow[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < memberLimit; i++) {
      for (const memberId of uniqueMemberXIds) {
        const candidate = byMember.get(memberId)?.[i];
        if (!candidate || seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        mixed.push(candidate);
        if (mixed.length >= 30) break;
      }
      if (mixed.length >= 30) break;
    }
    sharedMembers = mixed;
  }
  throwIfAborted(signal);

  const nearDateCandidateLimit = Math.min(16, nearDateLimit * 3);
  // Keep the near-date lookup indexable. A single ABS sort scans every public
  // video; two bounded range scans use the existing scheduled-time indexes and
  // are merged in memory to preserve the original distance/score ordering.
  const nearDate =
    scheduledTime != null
      ? await Promise.all([
          bindCurrent(
            `SELECT ${STATIC_RELATED_VIDEO_SELECT}
             FROM videos AS v
             WHERE ${baseWhere}
               AND v.scheduled_time IS NOT NULL
               AND v.scheduled_time <= ?
             ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC
             LIMIT ?`,
            scheduledTime,
            nearDateCandidateLimit,
          ).all(),
          bindCurrent(
            `SELECT ${STATIC_RELATED_VIDEO_SELECT}
             FROM videos AS v
             WHERE ${baseWhere}
               AND v.scheduled_time IS NOT NULL
               AND v.scheduled_time > ?
             ORDER BY v.scheduled_time ASC, COALESCE(v.score, 0) DESC
             LIMIT ?`,
            scheduledTime,
            nearDateCandidateLimit,
          ).all(),
        ]).then(([previousResult, nextResult]) => {
          const rows = [
            ...mapRows(previousResult.results ?? []),
            ...mapRows(nextResult.results ?? []),
          ];
          return rows
            .sort((a, b) => {
              const aDistance = Math.abs(
                (a.scheduled_time ?? scheduledTime) - scheduledTime,
              );
              const bDistance = Math.abs(
                (b.scheduled_time ?? scheduledTime) - scheduledTime,
              );
              if (aDistance !== bDistance) return aDistance - bDistance;
              // STATIC_RELATED_VIDEO_SELECT uses COALESCE(score, 0).
              return (b.video_score ?? 0) - (a.video_score ?? 0);
            })
            .slice(0, nearDateCandidateLimit);
        })
      : [];
  throwIfAborted(signal);

  let initialCandidates = interleaveBuckets<StaticRelatedVideoRow>([
    { reason: "previous_date", rows: temporalPrevious },
    { reason: "next_date", rows: temporalNext },
    { reason: "shared_member", rows: sharedMembers.slice(0, sharedLimit) },
    { reason: "same_event", rows: sameEvent.slice(0, sameEventLimit) },
    { reason: "same_creator", rows: sameCreator.slice(0, sameCreatorLimit) },
    { reason: "near_date", rows: nearDate.slice(0, nearDateLimit) },
  ]);

  const initialCandidateIds = new Set(
    initialCandidates.map((candidate) => candidate.row.id),
  );

  if (initialCandidateIds.size < targetCount) {
    const existingIds = [
      current.id,
      ...initialCandidateIds,
    ];
    const fallbackRows = mapRows(
      (
        await env.DB.prepare(
          `SELECT ${STATIC_RELATED_VIDEO_SELECT}
           FROM videos AS v
           WHERE ${baseWhere}
             AND v.id NOT IN (
               SELECT CAST(value AS TEXT)
               FROM json_each(?)
             )
           ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC, v.id DESC
           LIMIT ?`,
        )
          .bind(
            current.id,
            JSON.stringify(existingIds),
            targetCount - initialCandidateIds.size + 12,
          )
          .all()
      ).results ?? [],
    );

    for (const row of fallbackRows) {
      if (initialCandidateIds.has(row.id)) continue;
      initialCandidateIds.add(row.id);
      initialCandidates.push({
        row,
        reason: "near_date",
      });
    }
  }

  const selected = enforceDiversity(initialCandidates, {
    limit: relatedLimit,
    minTarget,
  });

  if (selected.length < minTarget) {
    const selectedIds = new Set(selected.map((candidate) => candidate.row.id));
    for (const candidate of initialCandidates) {
      if (selected.length >= minTarget) break;
      if (selectedIds.has(candidate.row.id)) continue;
      selectedIds.add(candidate.row.id);
      selected.push(candidate);
    }
  }

  const primaryRows = selected.map((candidate) => candidate.row);
  const primaryIds = new Set(primaryRows.map((row) => row.id));

  const reserveRows = uniqueByVideoId(
    initialCandidates.map((candidate) => candidate.row),
  )
    .filter((row) => !primaryIds.has(row.id))
    .slice(0, RELATED_RESERVE_LIMIT);

  return {
    primary: primaryRows.map(toPublicRelatedVideoCard),
    reserve: reserveRows.map(toPublicRelatedVideoCard),
  };
}

const REBUILD_VIDEO_SELECT = `SELECT v.id, v.title, v.youtube_video_id, v.creator_display_name, v.creator_x_user_id,
            creator_icon_url, v.creator_youtube_channel_url, v.creator_profile_text,
            v.creator_other_social_links, music, credit, music_reference_url, intro_comment, highlights,
            production_story, closing_comment, visibility_status, scheduled_time,
            COALESCE(v.app_like_count, 0) AS app_like_count,
            CASE WHEN EXISTS (
              SELECT 1 FROM events AS primary_event
              WHERE primary_event.id = v.primary_event_id
                AND primary_event.visibility_status = 'public'
            ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM x_users AS creator_xu
                WHERE creator_xu.id = v.creator_x_user_id
                  AND creator_xu.approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})
              )
              THEN 1
              ELSE 0
            END AS creator_has_public_profile,
            collaboration_type, part, updated_at
     FROM videos AS v`;

async function loadWorkerR2Json(
  env: Env,
  key: string,
  signal?: RebuildSignal,
): Promise<unknown | null> {
  throwIfAborted(signal);
  try {
    const object = await env.R2.get(key);
    throwIfAborted(signal);
    if (!object) return null;
    return await object.json();
  } catch {
    throwIfAborted(signal);
    return null;
  }
}

async function loadWorkerRandomPool(
  env: Env,
  signal?: RebuildSignal,
): Promise<RandomVideoPool> {
  const payload = await loadWorkerR2Json(
    env,
    RANDOM_VIDEO_POOL_OBJECT_KEY,
    signal,
  );
  return normalizeRandomVideoPool(payload) ?? EMPTY_RANDOM_VIDEO_POOL;
}

async function loadWorkerRelatedBlocklist(
  env: Env,
  signal?: RebuildSignal,
): Promise<YoutubeRelatedBlocklist> {
  const payload = await loadWorkerR2Json(
    env,
    YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
    signal,
  );
  const blocklist = normalizeYoutubeRelatedBlocklist(payload);
  if (!blocklist || blocklist.generatedAt == null) {
    throw new Error(
      "youtube_related_blocklist_required_for_static_generation",
    );
  }
  return blocklist;
}

async function fetchVideoRowForRebuild(
  env: Env,
  videoId: string,
  signal?: RebuildSignal,
): Promise<Record<string, unknown> | null> {
  throwIfAborted(signal);
  const byPk = await env.DB.prepare(`${REBUILD_VIDEO_SELECT} WHERE v.id = ? LIMIT 1`)
    .bind(videoId)
    .first();
  if (byPk) return byPk as Record<string, unknown>;
  if (isConfirmedInternalVideoId(videoId)) return null;
  throwIfAborted(signal);
  const byYoutube = await env.DB.prepare(
    `${REBUILD_VIDEO_SELECT} WHERE v.youtube_video_id = ? LIMIT 1`,
  )
    .bind(videoId)
    .first();
  return (byYoutube as Record<string, unknown> | null) ?? null;
}

async function rebuildVideo(
  env: Env,
  videoId: string,
  signal?: RebuildSignal,
  reason?: string | null,
): Promise<void> {
  throwIfAborted(signal);
  const row = await fetchVideoRowForRebuild(env, videoId, signal);
  throwIfAborted(signal);
  if (!row) {
    await removeTrackedArtifacts(env, "video", videoId, 20, signal);
    return;
  }
  const internalVideoId = String((row as { id: unknown }).id ?? "").trim();
  if (!internalVideoId) throw new Error(`Video id missing: ${videoId}`);
  const videoTarget = {
    targetType: "video",
    targetId: internalVideoId,
    sourceUpdatedAt: Number((row as { updated_at?: unknown }).updated_at ?? 0) || null,
  };
  const videoVisibility = String((row as { visibility_status?: unknown }).visibility_status ?? "");
  if (videoVisibility !== "public") {
    await removeTrackedArtifacts(env, "video", internalVideoId, 20, signal);
    return;
  }

  const [
    publicEvents,
    members,
    softwareLabels,
    publicChapters,
    memberChapters,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT e.id, e.title, e.icon_url, e.accent_color,
              e.start_time, e.end_time, e.entry_start_time, e.entry_end_time,
              e.visibility_status
       FROM video_events AS ve
       INNER JOIN events AS e
         ON e.id = ve.event_id AND e.visibility_status = 'public'
       WHERE ve.video_id = ?
       ORDER BY e.start_time DESC, e.id ASC`,
    )
      .bind(internalVideoId)
      .all(),
    env.DB.prepare(
      `SELECT vm.id, vm.name AS display_name, vm.x_user_id,
              vm.role AS role_label, vm.comment,
              xu.x_name, xu.icon_url,
              CASE
                WHEN xu.approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})
                THEN 1
                ELSE 0
              END AS has_public_profile,
               vm.order_index
       FROM video_members AS vm
       LEFT JOIN x_users AS xu ON xu.id = vm.x_user_id
       WHERE vm.video_id = ? AND vm.is_public_member = 1
       ORDER BY order_index ASC, vm.id ASC`,
    )
      .bind(internalVideoId)
      .all(),
    env.DB.prepare(
      `SELECT vs.raw_label
       FROM video_softwares AS vs
       INNER JOIN software_catalog AS sc ON sc.id = vs.software_id
       WHERE vs.video_id = ?
       ORDER BY sc.name ASC, vs.raw_label ASC`,
    )
      .bind(internalVideoId)
      .all<{ raw_label?: string }>(),
    env.DB.prepare(
      `SELECT vc.id, vc.chapter_time, vc.chapter_label, vc.note,
              xu.x_name AS author_name, xu.icon_url AS author_icon
       FROM video_chapters AS vc
       LEFT JOIN x_users AS xu ON xu.id = vc.x_user_id
       WHERE vc.video_id = ?
         AND vc.visibility = 'public'
         AND vc.id NOT LIKE '%:member:%'
         AND vc.id NOT LIKE '%:legacy:%'
       ORDER BY vc.chapter_time ASC, vc.id ASC`,
    )
      .bind(internalVideoId)
      .all(),
    env.DB.prepare(
      `SELECT vc.id, vc.x_user_id,
              vc.chapter_time, vc.chapter_label, vc.note
       FROM video_chapters AS vc
       WHERE vc.video_id = ?
         AND vc.visibility = 'public'
         AND (
           vc.id LIKE '%:member:%'
           OR vc.id LIKE '%:legacy:%'
         )
       ORDER BY vc.chapter_time ASC, vc.id ASC`,
    )
      .bind(internalVideoId)
      .all(),
  ]);
  throwIfAborted(signal);

  const publicMembersForProjection = (members.results ?? [])
    .map((entry) => ({
      id: String((entry as { id?: unknown }).id ?? "").trim(),
      x_user_id:
        (entry as { x_user_id?: unknown }).x_user_id == null
          ? null
          : String((entry as { x_user_id?: unknown }).x_user_id),
    }))
    .filter((entry) => Boolean(entry.id));

  const projectedMemberChapters = projectMemberChapters({
    chapters: (memberChapters.results ?? []).map((entry) => ({
      id: String((entry as { id?: unknown }).id ?? ""),
      x_user_id:
        (entry as { x_user_id?: unknown }).x_user_id == null
          ? null
          : String((entry as { x_user_id?: unknown }).x_user_id),
      chapter_time: Number(
        (entry as { chapter_time?: unknown }).chapter_time ?? 0,
      ),
      chapter_label: String(
        (entry as { chapter_label?: unknown }).chapter_label ?? "",
      ),
      note:
        (entry as { note?: unknown }).note == null
          ? null
          : String((entry as { note?: unknown }).note),
    })),
    publicMembers: publicMembersForProjection,
  });

  const eventIds = (publicEvents.results ?? []).map((entry) =>
    String((entry as { id: string }).id),
  );

  const publicMemberXIds = Array.from(
    new Set(
      (members.results ?? [])
        .map((entry) =>
          String(
            (entry as { x_user_id?: unknown }).x_user_id ?? "",
          )
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  );

  const [semanticSelection, randomPool, blocklist] = await Promise.all([
    fetchStaticRelatedVideos(
      env,
      {
        id: internalVideoId,
        creator_x_user_id:
          (row as { creator_x_user_id?: string | null }).creator_x_user_id ?? null,
        primary_event_id:
          (row as { primary_event_id?: string | null }).primary_event_id ?? null,
        scheduled_time:
          (row as { scheduled_time?: number | null }).scheduled_time ?? null,
        eventIds,
        memberXUserIds: publicMemberXIds,
      },
      signal,
    ),
    loadWorkerRandomPool(env, signal),
    loadWorkerRelatedBlocklist(env, signal),
  ]);
  throwIfAborted(signal);

  if (!randomPool.generationKey || randomPool.items.length === 0) {
    throw new Error("random_video_pool_required_for_video_v2");
  }

  const relatedLimit = clampRelatedLimit(RELATED_DEFAULT_LIMIT);
  const primarySemantic = semanticSelection.primary.slice(
    0,
    relatedLimit,
  );
  const relatedReserve = semanticSelection.reserve.slice(
    0,
    RELATED_RESERVE_LIMIT,
  );
  const semanticIds = new Set(primarySemantic.map((video) => String(video.id)));
  const blockedIds = blocklist.blockedIds;

  const randomSeed = [
    internalVideoId,
    randomPool.generationKey,
    blocklist.generatedAt,
  ].join(":");
  const randomCandidates = randomPool.items.filter(
    (candidate) =>
      candidate.id !== internalVideoId &&
      !semanticIds.has(candidate.id) &&
      !blockedIds.has(candidate.id),
  );
  const selectedRandom = selectDeterministicRandom(
    randomCandidates,
    RELATED_RANDOM_LIMIT,
    randomSeed,
  );
  const selectedRandomIds = new Set(selectedRandom.map((video) => video.id));
  const randomReserve = selectDeterministicRandom(
    randomCandidates.filter((candidate) => !selectedRandomIds.has(candidate.id)),
    RELATED_RANDOM_RESERVE_LIMIT,
    `${randomSeed}:reserve`,
  );

  const relatedVideos = insertRandomRelatedVideos({
    semantic: primarySemantic.filter(
      (video) => !blockedIds.has(video.id),
    ),
    random: selectedRandom,
    maxTarget: RELATED_DEFAULT_LIMIT,
  });

  const relatedSection = {
    related_videos: relatedVideos,
    related_reserve: relatedReserve
      .filter((video) => !blockedIds.has(video.id)),
    related_random_ids: selectedRandom.map((video) => video.id),
    related_random_reserve: randomReserve,
    related_random_seed: randomSeed,
  };

  if (relatedSectionByteLength(relatedSection) > RELATED_SECTION_MAX_BYTES) {
    throw new Error("video_related_section_too_large");
  }

  const payload = {
    schema_version: 2,
    generated_at: Math.floor(Date.now() / 1000),
    video: row,
    event_ids: eventIds,
    public_members: members.results ?? [],
    software_labels: (softwareLabels.results ?? [])
      .map((entry) => String(entry.raw_label ?? "").trim())
      .filter(Boolean),
    app_like_count: Number((row as { app_like_count?: unknown }).app_like_count ?? 0) || 0,
    public_chapters: publicChapters.results ?? [],
    member_chapters: projectedMemberChapters,
    public_events: publicEvents.results ?? [],
    ...relatedSection,
  };

  throwIfAborted(signal);
  await putJson(
    env,
    `videos/${internalVideoId}.json`,
    payload,
    "public, max-age=300, stale-while-revalidate=1800",
    videoTarget,
    signal,
  );
  const youtubeVideoId = String(
    (row as { youtube_video_id?: unknown }).youtube_video_id ?? "",
  ).trim();
  if (youtubeVideoId && youtubeVideoId !== internalVideoId) {
    await putJson(
      env,
      `videos/${youtubeVideoId}.json`,
      payload,
      "public, max-age=300, stale-while-revalidate=1800",
      videoTarget,
      signal,
    );
  }
  await reconcileTrackedArtifacts(env, videoTarget, [
    `videos/${internalVideoId}.json`,
    ...(youtubeVideoId && youtubeVideoId !== internalVideoId ? [`videos/${youtubeVideoId}.json`] : []),
  ], 20, signal);
  if (reason === "video_visibility_update") {
    await releaseVisibilityFenceAfterRebuild(env, "video", internalVideoId, signal);
  }
}

async function rebuildUsersIndex(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const sources = await loadPublicCreatorProjectionSources(env.DB, now);
  throwIfAborted(signal);
  const items = buildPublicUsersIndexItems(sources, now);
  const payload = { generated_at: now, items };
  assertNoForbiddenPublicKeys(payload);
  const serialized = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > USERS_INDEX_MAX_OBJECT_BYTES) {
    throw new Error(
      `users/index.json exceeds size limit (${byteLength} > ${USERS_INDEX_MAX_OBJECT_BYTES} bytes)`,
    );
  }
  throwIfAborted(signal);
  await putJson(
    env,
    USERS_INDEX_OBJECT_KEY,
    payload,
    "public, max-age=300, stale-while-revalidate=1800",
    { targetType: "users_index", targetId: "global" },
    signal,
  );

  const iconMap = buildPublicXIconMapPayloadFromProjection(sources, now);
  const iconBytes = publicXIconMapByteLength(iconMap);
  if (iconBytes > PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES) {
    throw new Error(
      `users/public-x-icon-map.v1.json exceeds size limit (${iconBytes} > ${PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES} bytes)`,
    );
  }
  await putJson(
    env,
    PUBLIC_X_ICON_MAP_OBJECT_KEY,
    iconMap,
    "public, max-age=300, stale-while-revalidate=1800",
    { targetType: "users_index", targetId: "global" },
    signal,
  );

  const pickupArtifact = buildPickupCreatorsArtifactFromProjection(sources, now);
  const pickupBytes = pickupCreatorsArtifactByteLength(pickupArtifact);
  if (pickupBytes > PICKUP_CREATORS_MAX_OBJECT_BYTES) {
    throw new Error(
      `users/pickup-creators.v1.json exceeds size limit (${pickupBytes} > ${PICKUP_CREATORS_MAX_OBJECT_BYTES} bytes)`,
    );
  }
  await putJson(
    env,
    PICKUP_CREATORS_OBJECT_KEY,
    pickupArtifact,
    "public, max-age=300, stale-while-revalidate=1800",
    { targetType: "users_index", targetId: "global" },
    signal,
  );
}

async function rebuildYoutubeRelatedBlocklist(
  env: Env,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `SELECT v.id AS video_id,
            v.visibility_status,
            ym.youtube_privacy_status,
            ym.youtube_availability_status
       FROM videos AS v
       LEFT JOIN video_youtube_metadata AS ym
         ON ym.video_id = v.id
      WHERE v.visibility_status <> 'public'
         OR (
          ym.youtube_privacy_status = 'private'
          OR ym.youtube_availability_status IN ('private', 'missing_or_private')
         )`,
  ).all<{
    video_id: string;
    visibility_status: string;
    youtube_privacy_status: string | null;
    youtube_availability_status: string | null;
  }>();
  throwIfAborted(signal);

  const blocked = new Map<string, YoutubeRelatedBlockReason>();
  for (const row of result.results ?? []) {
    const id = String(row.video_id ?? "").trim();
    if (!id) continue;

    if (row.visibility_status !== "public") {
      blocked.set(id, "private");
      continue;
    }

    if (
      row.youtube_privacy_status === "private" ||
      row.youtube_availability_status === "private"
    ) {
      blocked.set(id, "private");
      continue;
    }
    if (row.youtube_availability_status === "missing_or_private") {
      blocked.set(id, "missing_or_private");
    }
  }

  const payload = buildYoutubeRelatedBlocklistPayload(blocked, now);
  const byteLength = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (byteLength > YOUTUBE_RELATED_BLOCKLIST_MAX_OBJECT_BYTES) {
    throw new Error(
      `youtube/related-blocklist.v1.json exceeds size limit (${byteLength} > ${YOUTUBE_RELATED_BLOCKLIST_MAX_OBJECT_BYTES} bytes)`,
    );
  }
  await putJson(
    env,
    YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
    payload,
    "public, max-age=300, stale-while-revalidate=1800",
    { targetType: "youtube_related_blocklist", targetId: "global" },
    signal,
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function rebuildRandomVideoPool(
  env: Env,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);

  const result = await env.DB.prepare(
    `SELECT v.id, v.title, v.youtube_video_id,
            v.creator_display_name AS display_name,
            v.creator_icon_url AS icon_url,
            v.creator_x_user_id,
            v.primary_event_id,
            v.scheduled_time
       FROM videos AS v
      WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
        AND NOT EXISTS (
          SELECT 1
          FROM video_youtube_metadata AS related_ym
          WHERE related_ym.video_id = v.id
            AND (
              related_ym.youtube_privacy_status = 'private'
              OR related_ym.youtube_availability_status
                IN ('private', 'missing_or_private')
            )
        )
      ORDER BY v.id ASC
      LIMIT 5001`,
  ).all<Record<string, unknown>>();
  throwIfAborted(signal);

  const rows = result.results ?? [];
  if (rows.length > 5000) {
    throw new Error("random_video_pool_exceeds_5000_items");
  }

  const items = rows
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      title: String(row.title ?? "").trim(),
      youtube_video_id:
        row.youtube_video_id == null
          ? null
          : String(row.youtube_video_id).trim() || null,
      display_name: String(row.display_name ?? "").trim(),
      icon_url:
        row.icon_url == null ? null : String(row.icon_url).trim() || null,
      creator_x_user_id:
        row.creator_x_user_id == null
          ? null
          : String(row.creator_x_user_id).trim() || null,
      primary_event_id:
        row.primary_event_id == null
          ? null
          : String(row.primary_event_id).trim() || null,
      scheduled_time:
        Number.isFinite(Number(row.scheduled_time))
          ? Number(row.scheduled_time)
          : null,
    }))
    .filter((item) => item.id && item.title && item.display_name);

  const generationKey = await sha256Hex(
    buildRandomPoolGenerationMaterial(items),
  );
  const payload = {
    schema_version: RANDOM_VIDEO_POOL_SCHEMA_VERSION,
    generated_at: now,
    generation_key: generationKey,
    items,
  };
  const byteLength = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (byteLength > RANDOM_VIDEO_POOL_MAX_OBJECT_BYTES) {
    throw new Error(
      `videos/random-pool.v1.json exceeds size limit (${byteLength} > ${RANDOM_VIDEO_POOL_MAX_OBJECT_BYTES} bytes)`,
    );
  }
  await putJson(
    env,
    RANDOM_VIDEO_POOL_OBJECT_KEY,
    payload,
    "public, max-age=300, stale-while-revalidate=1800",
    { targetType: "random_video_pool", targetId: "global" },
    signal,
  );
}

async function rebuildRules(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT version_label, body_markdown, published_at, updated_at
     FROM terms_versions
     WHERE status = 'published'
     ORDER BY published_at DESC, updated_at DESC
     LIMIT 1`,
  ).first<{
    version_label?: string;
    body_markdown?: string;
    published_at?: number | null;
    updated_at?: number | null;
  }>();
  throwIfAborted(signal);
  const payload = row
    ? {
        generated_at: now,
        version_label: row.version_label,
        body_markdown: row.body_markdown,
        published_at: row.published_at ?? null,
        updated_at: row.updated_at ?? row.published_at ?? null,
      }
    : {
        generated_at: now,
        version_label: DEFAULT_TERMS_VERSION_LABEL,
        body_markdown: DEFAULT_TERMS_MARKDOWN,
        published_at: null,
        updated_at: null,
      };
  await putJson(
    env,
    "rules/current.json",
    payload,
    "public, max-age=3600, stale-while-revalidate=86400",
    { targetType: "rules", targetId: "global" },
    signal,
  );
}

async function rebuildRecommendCore(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const [recommended, latest, underrated] = await Promise.all([
    env.DB.prepare(
      `SELECT ${STATIC_RECOMMEND_VIDEO_SELECT}
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY COALESCE(v.score, 0) DESC, v.scheduled_time DESC
       LIMIT 180`,
    ).all(),
    env.DB.prepare(
      `SELECT ${STATIC_RECOMMEND_VIDEO_SELECT}
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY v.scheduled_time DESC
       LIMIT 120`,
    ).all(),
    env.DB.prepare(
      `SELECT ${STATIC_RECOMMEND_VIDEO_SELECT}
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY COALESCE(v.score, 0) ASC, v.scheduled_time DESC
       LIMIT 120`,
    ).all(),
  ]);

  throwIfAborted(signal);
  await putJson(
    env,
    RECOMMEND_CORE_OBJECT_KEY,
    {
      schema_version: RECOMMEND_CORE_SCHEMA_VERSION,
      generated_at: now,
      recommended: recommended.results ?? [],
      latest: latest.results ?? [],
      underrated: underrated.results ?? [],
    },
    staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.recommend),
    { targetType: "recommend_core", targetId: "global" },
    signal,
  );
}

async function rebuildRecommend(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const corePayload = await loadWorkerR2Json(env, RECOMMEND_CORE_OBJECT_KEY, signal);
  const core = normalizeRecommendCore(corePayload);
  if (!core) {
    throw new Error("recommend_core_required_for_recommend_composer");
  }
  throwIfAborted(signal);
  const creators = await resolvePickupCreatorsWithFallback(env, 60, "rebuildRecommend", signal);
  await putJson(
    env,
    "recommend.json",
    {
      generated_at: core.generatedAt,
      recommended: core.recommended,
      latest: core.latest,
      underrated: core.underrated,
      creators,
    },
    "public, max-age=300, stale-while-revalidate=1800",
    { targetType: "recommend", targetId: "global" },
    signal,
  );
}

const STATIC_USER_PROFILE_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  v.creator_display_name AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  v.scheduled_time,
  v.visibility_status AS status,
  v.part
`;

const STATIC_USER_COLLAB_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  COALESCE(v.creator_display_name, v.creator_x_user_id) AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  v.scheduled_time,
  v.visibility_status AS status,
  v.part
`;

async function rebuildUser(env: Env, xId: string, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const user = await env.DB.prepare(
    `SELECT id, x_name, icon_url, profile_text, portfolio_contact,
            youtube_channel_url, other_social_links
     FROM x_users WHERE id = ? AND approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN}) LIMIT 1`,
  )
    .bind(xId)
    .first();
  throwIfAborted(signal);
  if (!user) {
    await removeTrackedArtifacts(env, "user", xId, 20, signal);
    return;
  }

  const userTarget = { targetType: "user", targetId: xId };
  const cacheControl = "public, max-age=600, stale-while-revalidate=3600";
  const generatedAt = Math.floor(Date.now() / 1000);
  const liveKeys: string[] = [`users/${xId}.json`];

  const [ownVideos, collabVideos] = await Promise.all([
    env.DB.prepare(
      `SELECT ${STATIC_USER_PROFILE_VIDEO_SELECT},
              COUNT(*) OVER() AS total_count
       FROM videos AS v
       WHERE v.creator_x_user_id = ?
         AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
      .bind(xId, STATIC_USER_MAX_STATIC_ITEMS)
      .all<{ total_count?: number }>(),
    env.DB.prepare(
      `SELECT ${STATIC_USER_COLLAB_VIDEO_SELECT},
              COUNT(*) OVER() AS total_count
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND LOWER(COALESCE(v.creator_x_user_id, '')) <> LOWER(?)
         AND EXISTS (
           SELECT 1
           FROM video_members AS vm
           WHERE vm.video_id = v.id
             AND vm.is_public_member = 1
             AND LOWER(vm.x_user_id) = LOWER(?)
         )
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
      .bind(xId, xId, STATIC_USER_MAX_STATIC_ITEMS)
      .all<{ total_count?: number }>(),
  ]);

  throwIfAborted(signal);
  const ownRows = ownVideos.results ?? [];
  const collabRows = collabVideos.results ?? [];
  const ownTotal =
    ownRows.length > 0 ? Number(ownRows[0]?.total_count ?? 0) : 0;
  const collabTotal =
    collabRows.length > 0 ? Number(collabRows[0]?.total_count ?? 0) : 0;
  const ownItems = ownRows.map(({ total_count: _totalCount, ...row }) => row);
  const collabItems = collabRows.map(({ total_count: _totalCount, ...row }) => row);

  await putJson(
    env,
    `users/${xId}.json`,
    {
      generated_at: generatedAt,
      user,
      page_size: STATIC_USER_WORKS_PAGE_SIZE,
      works: {
        total: ownTotal,
        items: ownItems.slice(0, STATIC_USER_WORKS_PAGE_SIZE),
      },
      collabs: {
        total: collabTotal,
        items: collabItems.slice(0, STATIC_USER_COLLABS_PAGE_SIZE),
      },
    },
    cacheControl,
    userTarget,
    signal,
  );

  const ownPageCount = Math.min(
    STATIC_USER_MAX_PAGES,
    Math.max(1, Math.ceil(ownItems.length / STATIC_USER_WORKS_PAGE_SIZE)),
  );
  for (let page = 2; page <= ownPageCount; page += 1) {
    const key = `users/${xId}/works/${page}.json`;
    liveKeys.push(key);
    await putJson(
      env,
      key,
      {
        generated_at: generatedAt,
        page,
        page_size: STATIC_USER_WORKS_PAGE_SIZE,
        total: ownTotal,
        items: ownItems.slice(
          (page - 1) * STATIC_USER_WORKS_PAGE_SIZE,
          page * STATIC_USER_WORKS_PAGE_SIZE,
        ),
      },
      cacheControl,
      userTarget,
      signal,
    );
  }

  const collabPageCount = Math.min(
    STATIC_USER_MAX_PAGES,
    Math.max(1, Math.ceil(collabItems.length / STATIC_USER_COLLABS_PAGE_SIZE)),
  );
  for (let page = 2; page <= collabPageCount; page += 1) {
    const key = `users/${xId}/collabs/${page}.json`;
    liveKeys.push(key);
    await putJson(
      env,
      key,
      {
        generated_at: generatedAt,
        page,
        page_size: STATIC_USER_COLLABS_PAGE_SIZE,
        total: collabTotal,
        items: collabItems.slice(
          (page - 1) * STATIC_USER_COLLABS_PAGE_SIZE,
          page * STATIC_USER_COLLABS_PAGE_SIZE,
        ),
      },
      cacheControl,
      userTarget,
      signal,
    );
  }

  await reconcileTrackedArtifacts(env, userTarget, liveKeys, 20, signal);
}
