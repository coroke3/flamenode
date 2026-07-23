import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  cacheControlForFreshness,
  resolveEventFreshness,
} from "./freshness.ts";
import { staticArtifactContentHash } from "./r2Dedup.ts";
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
  RELATED_DEFAULT_LIMIT,
  uniqueByVideoId,
} from "../../src/lib/db/recommendation.ts";

const STATIC_USER_WORKS_PAGE_SIZE = 24;
const STATIC_USER_COLLABS_PAGE_SIZE = 24;
const STATIC_USER_MAX_PAGES = 5;
const STATIC_USER_MAX_STATIC_ITEMS =
  STATIC_USER_WORKS_PAGE_SIZE * STATIC_USER_MAX_PAGES;

type Env = { DB: D1Database; R2: R2Bucket; KV: KVNamespace };
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

const EVENT_INDEX_COLUMNS = `
  id, title, explanation, icon_url, img_url, accent_color,
  event_type, slot_type, slot_visibility_mode,
  max_slots_per_video,
  start_time, end_time, entry_start_time, entry_end_time,
  visibility_status, created_at
`;

const PVSF_SUMMARY_EVENT_ID = "PVSFSummary";
export const POPULAR_LIST_LIMIT = 60;

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

const COUNTABLE_PUBLIC_VIDEO_SQL = `
  v.visibility_status = 'public'
  AND COALESCE(v.primary_event_id, '') <> '${PVSF_SUMMARY_EVENT_ID}'
  AND NOT EXISTS (
    SELECT 1 FROM video_events AS pvsf_summary_video_events
    WHERE pvsf_summary_video_events.video_id = v.id
      AND pvsf_summary_video_events.event_id = '${PVSF_SUMMARY_EVENT_ID}'
  )
`;

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
): Promise<void> {
  throwIfAborted(signal);
  switch (targetType) {
    case "top":
      await rebuildTop(env, signal);
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
    case "event":
      await rebuildEvent(env, targetId, signal);
      break;
    case "video":
      await rebuildVideo(env, targetId, signal);
      break;
    case "user":
      await rebuildUser(env, targetId, signal);
      break;
    case "users_index":
      await rebuildUsersIndex(env, signal);
      break;
    case "list_popular":
      await rebuildListPopular(env, signal);
      break;
    case "recommend":
      await rebuildRecommend(env, signal);
      break;
    case "rules":
      await rebuildRules(env, signal);
      break;
    default:
      throw new Error(`Unknown target_type: ${targetType}`);
  }
  throwIfAborted(signal);
  if (["top", "list_recent", "list_popular", "events_index", "search_index", "users_index", "recommend", "rules"].includes(targetType)) {
    const keys: Record<string, string> = {
      top: "top.json",
      list_recent: "list/recent.json",
      list_popular: "list/popular.json",
      events_index: "events/index.json",
      search_index: "search-index-lite.json",
      users_index: "users/index.json",
      recommend: "recommend.json",
      rules: "rules/current.json",
    };
    await reconcileTrackedArtifacts(
      env,
      { targetType, targetId: "global" },
      [keys[targetType]],
      20,
      signal,
    );
  }
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

async function rebuildTop(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const [
    recommended,
    latest,
    activeEvents,
    latestEvents,
    creators,
    announcements,
    slotStats,
    publicVideoCount,
    creatorCount,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, youtube_video_id,
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
       FROM videos AS v
       WHERE v.visibility_status = 'public'
       ORDER BY COALESCE(score, 0) DESC, scheduled_time DESC
       LIMIT 40`,
    ).all(),
    env.DB.prepare(
      `SELECT id, title, youtube_video_id,
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
       FROM videos AS v
       WHERE v.visibility_status = 'public'
       ORDER BY scheduled_time DESC
       LIMIT 30`,
    ).all(),
    env.DB.prepare(
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
    ).bind(now).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT ${EVENT_INDEX_COLUMNS}
       FROM events
       WHERE visibility_status = 'public'
         AND ${NON_POINT_EVENT_PERIOD_SQL}
       ORDER BY start_time DESC
       LIMIT 12`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `WITH creator_counts AS (
         SELECT
           xu.id,
           xu.x_name,
           xu.icon_url,
           (
             SELECT COUNT(DISTINCT v.id)
             FROM videos AS v
             WHERE v.creator_x_user_id = xu.id
               AND v.visibility_status = 'public'
               AND COALESCE(v.primary_event_id, '') <> ?
               AND NOT EXISTS (
                 SELECT 1 FROM video_events AS pvsf_summary_video_events
                 WHERE pvsf_summary_video_events.video_id = v.id
                   AND pvsf_summary_video_events.event_id = ?
               )
           ) AS video_count,
           (
             SELECT COUNT(DISTINCT vm.video_id)
             FROM video_members AS vm
             INNER JOIN videos AS v ON v.id = vm.video_id
             WHERE vm.x_user_id = xu.id
               AND v.visibility_status = 'public'
               AND COALESCE(v.primary_event_id, '') <> ?
               AND NOT EXISTS (
                 SELECT 1 FROM video_events AS pvsf_summary_video_events
                 WHERE pvsf_summary_video_events.video_id = v.id
                   AND pvsf_summary_video_events.event_id = ?
               )
           ) AS collab_count
         FROM x_users AS xu
         WHERE xu.approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})
       )
       SELECT id, x_name, icon_url, video_count, collab_count
       FROM creator_counts
       WHERE video_count >= 1 OR collab_count >= 2
       ORDER BY (video_count + collab_count) DESC, video_count DESC, x_name ASC
       LIMIT 30`,
    )
      .bind(
        PVSF_SUMMARY_EVENT_ID,
        PVSF_SUMMARY_EVENT_ID,
        PVSF_SUMMARY_EVENT_ID,
        PVSF_SUMMARY_EVENT_ID,
      )
      .all(),
    env.DB.prepare(
      `SELECT id, title, body, severity, publish_at, expire_at
       FROM announcements
       WHERE is_published = 1
         AND target_audience = 'all'
         AND (publish_at IS NULL OR publish_at <= ?)
         AND (expire_at IS NULL OR expire_at > ?)
       ORDER BY publish_at DESC, updated_at DESC
       LIMIT 3`,
    ).bind(now, now).all(),
    env.DB.prepare(
      `SELECT s.event_id,
              SUM(CASE WHEN s.status = 'available' THEN 1 ELSE 0 END) AS available,
              COUNT(*) AS total
       FROM slots AS s
       INNER JOIN events AS e
         ON e.id = s.event_id AND e.visibility_status = 'public'
       GROUP BY s.event_id`,
    ).all(),
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

  const activeEventItems = activeEvents.results ?? [];
  const latestEventItems = latestEvents.results ?? [];
  const payload = {
    generated_at: now,
    recommended: recommended.results ?? [],
    latest: latest.results ?? [],
    items: latest.results ?? [],
    active_events: activeEventItems,
    latest_events: latestEventItems,
    creators: creators.results ?? [],
    announcements: announcements.results ?? [],
    slot_stats: slotStats.results ?? [],
    stats: {
      public_videos: Number(publicVideoCount?.c ?? latest.results?.length ?? 0),
      active_events: activeEventItems.length,
      public_events: Number(publicEventCount?.c ?? latestEventItems.length ?? 0),
      creators: Number(creatorCount?.c ?? creators.results?.length ?? 0),
    },
  };
  throwIfAborted(signal);
  await putJson(env, "top.json", payload, "public, max-age=60, stale-while-revalidate=300", { targetType: "top", targetId: "global" }, signal);
  throwIfAborted(signal);
  await env.KV.put(
    "static:top",
    JSON.stringify({
      generated_at: payload.generated_at,
      count: payload.latest.length,
      active_events: payload.active_events.length,
    }),
    { expirationTtl: 600 },
  );
  throwIfAborted(signal);
}

async function rebuildListRecent(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const [rows, totalRow] = await Promise.all([
    env.DB.prepare(
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
     WHERE v.visibility_status = 'public'
     ORDER BY v.scheduled_time DESC LIMIT 120`,
    ).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c FROM videos WHERE visibility_status = 'public'`,
    ).first<{ c?: number }>(),
  ]);
  throwIfAborted(signal);
  await putJson(env, "list/recent.json", {
    generated_at: Math.floor(Date.now() / 1000),
    total: Number(totalRow?.c ?? rows.results?.length ?? 0),
    items: rows.results ?? [],
  }, "public, max-age=120, stale-while-revalidate=600", { targetType: "list_recent", targetId: "global" }, signal);
}

async function rebuildListPopular(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const [rows, totalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT ${STATIC_LIST_VIDEO_SELECT}
       ${STATIC_LIST_VIDEO_FROM}
       WHERE v.visibility_status = 'public'
       ORDER BY COALESCE(v.score, 0) DESC, v.scheduled_time DESC
       LIMIT ?`,
    )
      .bind(POPULAR_LIST_LIMIT)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c FROM videos WHERE visibility_status = 'public'`,
    ).first<{ c?: number }>(),
  ]);
  throwIfAborted(signal);
  await putJson(env, "list/popular.json", {
    generated_at: Math.floor(Date.now() / 1000),
    total: Number(totalRow?.c ?? rows.results?.length ?? 0),
    items: rows.results ?? [],
  }, "public, max-age=300, stale-while-revalidate=1800", { targetType: "list_popular", targetId: "global" }, signal);
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
     FROM videos WHERE visibility_status = 'public'
     ORDER BY updated_at DESC LIMIT 500`,
  ).all();
  const users = await env.DB.prepare(
    `SELECT id, x_name FROM x_users
     WHERE approval_status = 'approved'
     ORDER BY id ASC LIMIT 500`,
  ).all();
  throwIfAborted(signal);
  await putJson(env, "search-index-lite.json", {
    generated_at: Math.floor(Date.now() / 1000),
    videos: videos.results ?? [],
    users: users.results ?? [],
  }, "public, max-age=600, stale-while-revalidate=3600", { targetType: "search_index", targetId: "global" }, signal);
}

async function rebuildEvent(env: Env, eventId: string, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const ev = (
    await env.DB.prepare(
      `SELECT ${EVENT_DETAIL_COLUMNS}
       FROM events WHERE id = ? LIMIT 1`,
    )
      .bind(eventId)
      .first()
  ) as Record<string, unknown> | null;
  throwIfAborted(signal);
  if (!ev) {
    await removeTrackedArtifacts(env, "event", eventId, 20, signal);
    return;
  }
  const visibility = String(ev.visibility_status ?? "");
  if (visibility !== "public") {
    await removeTrackedArtifacts(env, "event", eventId, 20, signal);
    return;
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
  const eventPayload = ev;
  const eventVideoWhere = eventPublicVideoWhereSql("v");

  const [
    staff,
    slotSummary,
    publicSlots,
    publicVideos,
    videoTotalRow,
    creatorCountRow,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT es.display_name, es.public_role_label,
              xu.id AS x_user_id, xu.x_name, xu.icon_url
       FROM event_staff AS es
       LEFT JOIN x_users AS xu ON xu.id = es.x_user_id
       WHERE es.event_id = ? AND es.is_public = 1
       ORDER BY es.created_at ASC`,
    )
      .bind(eventId)
      .all(),
    env.DB.prepare(
      `SELECT status, COUNT(*) AS c FROM slots WHERE event_id = ? GROUP BY status`,
    )
      .bind(eventId)
      .all(),
    env.DB.prepare(
      `SELECT id, status, start_time, sort_order
       FROM slots
       WHERE event_id = ?
       ORDER BY start_time ASC, sort_order ASC, id ASC`,
    )
      .bind(eventId)
      .all(),
    env.DB.prepare(
      `SELECT v.id, v.title, v.youtube_video_id, v.creator_display_name,
              v.creator_x_user_id, v.creator_icon_url, v.visibility_status,
              v.scheduled_time, v.part
       FROM videos AS v
       WHERE ${eventVideoWhere}
       ORDER BY v.scheduled_time ASC, v.id ASC
       LIMIT 500`,
    )
      .bind(eventId, eventId)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM videos AS v
       WHERE ${eventVideoWhere}`,
    )
      .bind(eventId, eventId)
      .first<{ c?: number }>(),
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
  const payload = {
    generated_at: now,
    freshness,
    event: eventPayload,
    public_staff: staff.results ?? [],
    slots_summary: slotSummary.results ?? [],
    slots: publicSlots.results ?? [],
    public_videos: publicVideos.results ?? [],
    video_total: Number(videoTotalRow?.c ?? publicVideos.results?.length ?? 0),
    creator_count: Number(creatorCountRow?.c ?? 0),
  };

  await putJson(
    env,
    `events/${eventId}.json`,
    payload,
    cacheControlForFreshness(freshness),
    { targetType: "event", targetId: eventId, sourceUpdatedAt: Number(ev.updated_at ?? 0) || null },
    signal,
  );
  await reconcileTrackedArtifacts(env, { targetType: "event", targetId: eventId }, [`events/${eventId}.json`], 20, signal);
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
  };
}

function toPublicRelatedVideoCard(row: StaticRelatedVideoRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    youtube_video_id: row.youtube_video_id,
    display_name: row.display_name,
    icon_url: row.icon_url,
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
  },
  signal?: RebuildSignal,
): Promise<Record<string, unknown>[]> {
  throwIfAborted(signal);
  const relatedLimit = clampRelatedLimit(RELATED_DEFAULT_LIMIT);
  const minTarget = Math.min(15, relatedLimit);
  const sameEventLimit = 5;
  const sameCreatorLimit = 4;
  const nearDateLimit = 4;
  const sharedLimit = 8;

  const baseWhere = `v.visibility_status = 'public' AND v.id <> ?`;
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
                 INNER JOIN video_events AS ve ON ve.video_id = v.id
                 WHERE ${baseWhere}
                   AND ve.event_id IN (${eventIds.map(() => "?").join(",")})
                 ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC
                 LIMIT ?`,
              )
                .bind(current.id, ...eventIds, Math.min(24, sameEventLimit * 4))
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

  const memberRows =
    (
      await env.DB.prepare(
        `SELECT LOWER(vm.x_user_id) AS member_x_user_id
         FROM video_members AS vm
         WHERE vm.video_id = ?
           AND vm.is_public_member = 1
           AND vm.x_user_id IS NOT NULL`,
      )
        .bind(current.id)
        .all<{ member_x_user_id?: string }>()
    ).results ?? [];
  const uniqueMemberXIds = Array.from(
    new Set(
      memberRows
        .map((row) => String(row.member_x_user_id ?? "").trim().toLowerCase())
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
             AND vm.x_user_id IS NOT NULL
             AND LOWER(vm.x_user_id) IN (${uniqueMemberXIds.map(() => "?").join(",")})
           ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC
           LIMIT 30`,
        )
          .bind(current.id, ...uniqueMemberXIds)
          .all()
      ).results ?? [],
    );
    const byMember = new Map<string, StaticRelatedVideoRow[]>();
    for (const row of sharedRows) {
      const memberId = String(
        (row as StaticRelatedVideoRow & { member_x_user_id?: string })
          .member_x_user_id ?? "",
      ).trim();
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

  const nearDate =
    scheduledTime != null
      ? mapRows(
          (
            await bindCurrent(
              `SELECT ${STATIC_RELATED_VIDEO_SELECT}
               FROM videos AS v
               WHERE ${baseWhere}
                 AND v.scheduled_time IS NOT NULL
               ORDER BY ABS(v.scheduled_time - ?), COALESCE(v.score, 0) DESC
               LIMIT ?`,
              scheduledTime,
              Math.min(16, nearDateLimit * 3),
            ).all()
          ).results ?? [],
        )
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

  if (initialCandidates.length < minTarget) {
    const existingIds = initialCandidates.map((candidate) => candidate.row.id);
    existingIds.push(current.id);
    const fallbackRows = mapRows(
      (
        await env.DB.prepare(
          `SELECT ${STATIC_RELATED_VIDEO_SELECT}
           FROM videos AS v
           WHERE ${baseWhere}
             AND v.id NOT IN (${existingIds.map(() => "?").join(",")})
           ORDER BY v.scheduled_time DESC, COALESCE(v.score, 0) DESC
           LIMIT ?`,
        )
          .bind(current.id, ...existingIds, minTarget - initialCandidates.length + 5)
          .all()
      ).results ?? [],
    );
    for (const row of fallbackRows) {
      if (!initialCandidates.some((candidate) => candidate.row.id === row.id)) {
        initialCandidates.push({ row, reason: "near_date" });
      }
    }
  }

  const selected = enforceDiversity(initialCandidates, {
    limit: relatedLimit,
    minTarget,
  });

  return selected.map((candidate) => toPublicRelatedVideoCard(candidate.row));
}

async function rebuildVideo(env: Env, videoId: string, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const row = await env.DB.prepare(
    `SELECT v.id, v.title, v.youtube_video_id, v.creator_display_name, v.creator_x_user_id,
            creator_icon_url, music, credit, music_reference_url, intro_comment, highlights,
            production_story, closing_comment, visibility_status, scheduled_time,
            COALESCE(v.app_like_count, 0) AS app_like_count,
            CASE WHEN EXISTS (
              SELECT 1 FROM events AS primary_event
              WHERE primary_event.id = v.primary_event_id
                AND primary_event.visibility_status = 'public'
            ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
            collaboration_type, part, updated_at
     FROM videos AS v
     WHERE v.id = ? OR v.youtube_video_id = ?
     ORDER BY CASE WHEN v.id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  )
    .bind(videoId, videoId, videoId)
    .first();
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
    events,
    publicEvents,
    members,
    softwareLabels,
    publicChapters,
    memberChapters,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT ve.event_id
       FROM video_events AS ve
       INNER JOIN events AS e
         ON e.id = ve.event_id AND e.visibility_status = 'public'
       WHERE ve.video_id = ?`,
    )
      .bind(internalVideoId)
      .all(),
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
      `SELECT id, name AS display_name, x_user_id, role AS role_label, order_index
       FROM video_members
       WHERE video_id = ? AND is_public_member = 1
       ORDER BY order_index ASC`,
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
      `SELECT vc.id, vc.chapter_time, vc.chapter_label, vc.note,
              CASE
                WHEN instr(vc.id, ':member:') > 0
                  THEN substr(vc.id, 1, instr(vc.id, ':member:') - 1)
                WHEN instr(vc.id, ':legacy:') > 0
                  THEN substr(vc.id, 1, instr(vc.id, ':legacy:') - 1)
              END AS video_member_id
       FROM video_chapters AS vc
       INNER JOIN video_members AS vm
         ON vm.id = CASE
           WHEN instr(vc.id, ':member:') > 0
             THEN substr(vc.id, 1, instr(vc.id, ':member:') - 1)
           WHEN instr(vc.id, ':legacy:') > 0
             THEN substr(vc.id, 1, instr(vc.id, ':legacy:') - 1)
         END
       WHERE vc.video_id = ?
         AND vc.visibility = 'public'
         AND vm.is_public_member = 1
         AND (vc.id LIKE '%:member:%' OR vc.id LIKE '%:legacy:%')
       ORDER BY vc.chapter_time ASC, vc.id ASC`,
    )
      .bind(internalVideoId)
      .all(),
  ]);
  throwIfAborted(signal);

  const eventIds = (events.results ?? []).map(
    (entry) => (entry as { event_id: string }).event_id,
  );
  const relatedVideos = await fetchStaticRelatedVideos(
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
    },
    signal,
  );

  const payload = {
    generated_at: Math.floor(Date.now() / 1000),
    video: row,
    event_ids: eventIds,
    public_members: members.results ?? [],
    software_labels: (softwareLabels.results ?? [])
      .map((entry) => String(entry.raw_label ?? "").trim())
      .filter(Boolean),
    app_like_count: Number((row as { app_like_count?: unknown }).app_like_count ?? 0) || 0,
    public_chapters: publicChapters.results ?? [],
    member_chapters: memberChapters.results ?? [],
    public_events: publicEvents.results ?? [],
    related_videos: relatedVideos,
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
}

async function rebuildUsersIndex(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const [registeredRows, orphanRows] = await Promise.all([
    env.DB.prepare(
      `SELECT
         xu.id AS x_id,
         COALESCE(
           xu.x_name,
           (SELECT v.creator_display_name FROM videos AS v
            WHERE v.creator_x_user_id = xu.id
              AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
            ORDER BY v.scheduled_time DESC LIMIT 1),
           xu.id
         ) AS x_name,
         COALESCE(
           xu.icon_url,
           (SELECT v.creator_icon_url FROM videos AS v
            WHERE v.creator_x_user_id = xu.id
              AND v.creator_icon_url IS NOT NULL
              AND v.collaboration_type = 'individual'
              AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
            ORDER BY v.scheduled_time DESC LIMIT 1),
           (SELECT v.creator_icon_url FROM videos AS v
            WHERE v.creator_x_user_id = xu.id
              AND v.creator_icon_url IS NOT NULL
              AND v.collaboration_type = 'collab'
              AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
            ORDER BY v.scheduled_time DESC LIMIT 1)
         ) AS icon_url,
         xu.profile_text,
         xu.youtube_channel_url,
         (
           SELECT COUNT(DISTINCT v.id)
           FROM videos AS v
           WHERE v.creator_x_user_id = xu.id
             AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
         ) AS personal_count,
         (
           SELECT COUNT(DISTINCT vm.video_id)
           FROM video_members AS vm
           INNER JOIN videos AS v ON v.id = vm.video_id
           WHERE vm.x_user_id = xu.id
             AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
         ) AS collab_count,
         (
           SELECT COUNT(DISTINCT v.id)
           FROM videos AS v
           LEFT JOIN video_members AS vm ON vm.video_id = v.id
           WHERE (v.creator_x_user_id = xu.id OR vm.x_user_id = xu.id)
             AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
         ) AS total_works,
         COALESCE(xu.updated_at, xu.created_at, ?) AS updated_at
       FROM x_users AS xu
       WHERE xu.approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})`,
    ).bind(now).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT
         v.creator_x_user_id AS x_id,
         COALESCE(
           (SELECT v2.creator_display_name FROM videos AS v2
            WHERE v2.creator_x_user_id = v.creator_x_user_id
              AND ${COUNTABLE_PUBLIC_VIDEO_SQL.replaceAll("v.", "v2.")}
            ORDER BY v2.scheduled_time DESC, v2.created_at DESC LIMIT 1),
           v.creator_x_user_id
         ) AS x_name,
         COALESCE(
           (SELECT v2.creator_icon_url FROM videos AS v2
            WHERE v2.creator_x_user_id = v.creator_x_user_id
              AND v2.creator_icon_url IS NOT NULL
              AND v2.collaboration_type = 'individual'
              AND ${COUNTABLE_PUBLIC_VIDEO_SQL.replaceAll("v.", "v2.")}
            ORDER BY v2.scheduled_time DESC, v2.created_at DESC LIMIT 1),
           (SELECT v2.creator_icon_url FROM videos AS v2
            WHERE v2.creator_x_user_id = v.creator_x_user_id
              AND v2.creator_icon_url IS NOT NULL
              AND v2.collaboration_type = 'collab'
              AND ${COUNTABLE_PUBLIC_VIDEO_SQL.replaceAll("v.", "v2.")}
            ORDER BY v2.scheduled_time DESC, v2.created_at DESC LIMIT 1)
         ) AS icon_url,
         NULL AS profile_text,
         NULL AS youtube_channel_url,
         COUNT(DISTINCT v.id) AS personal_count,
         0 AS collab_count,
         COUNT(DISTINCT v.id) AS total_works,
         MAX(v.updated_at) AS updated_at
       FROM videos AS v
       LEFT JOIN x_users AS xu ON xu.id = v.creator_x_user_id
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND v.creator_x_user_id <> 'anonymous'
         AND xu.id IS NULL
       GROUP BY v.creator_x_user_id`,
    ).all<Record<string, unknown>>(),
  ]);

  throwIfAborted(signal);
  const items = [...(registeredRows.results ?? []), ...(orphanRows.results ?? [])]
    .map((row) => {
      const personalCount = Number(row.personal_count ?? 0) || 0;
      const collabCount = Number(row.collab_count ?? 0) || 0;
      const totalWorks = Number(row.total_works ?? 0) || 0;
      const profileText =
        row.profile_text == null ? null : String(row.profile_text).trim() || null;
      const youtubeChannelUrl =
        row.youtube_channel_url == null
          ? null
          : String(row.youtube_channel_url).trim() || null;
      if (totalWorks <= 0 && !profileText && !youtubeChannelUrl) return null;
      return {
        x_id: String(row.x_id ?? "").trim(),
        x_name: String(row.x_name ?? "").trim(),
        icon_url: row.icon_url == null ? null : String(row.icon_url),
        profile_text: profileText,
        youtube_channel_url: youtubeChannelUrl,
        personal_count: personalCount,
        collab_count: collabCount,
        total_works: totalWorks,
        sort_score: totalWorks * 2 + personalCount,
        updated_at: normalizeNumber(row.updated_at) ?? now,
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row?.x_id && !!row.x_name)
    .sort(
      (a, b) =>
        b.sort_score - a.sort_score ||
        a.x_name.localeCompare(b.x_name, "ja"),
    );

  await putJson(
    env,
    "users/index.json",
    {
      generated_at: now,
      items,
    },
    "public, max-age=300, stale-while-revalidate=1800",
    { targetType: "users_index", targetId: "global" },
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

async function rebuildRecommend(env: Env, signal?: RebuildSignal): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const [recommended, latest, underrated, creators] = await Promise.all([
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
    env.DB.prepare(
      `WITH creator_counts AS (
         SELECT
           xu.id,
           xu.x_name,
           xu.icon_url,
           (
             SELECT COUNT(DISTINCT v.id)
             FROM videos AS v
             WHERE v.creator_x_user_id = xu.id
               AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
           ) AS video_count,
           (
             SELECT COUNT(DISTINCT vm.video_id)
             FROM video_members AS vm
             INNER JOIN videos AS v ON v.id = vm.video_id
             WHERE vm.x_user_id = xu.id
               AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
           ) AS collab_count
         FROM x_users AS xu
         WHERE xu.approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})
       )
       SELECT id, x_name, icon_url, video_count, collab_count
       FROM creator_counts
       WHERE video_count >= 1 OR collab_count >= 2
       ORDER BY (video_count + collab_count) DESC, video_count DESC, x_name ASC
       LIMIT 60`,
    ).all(),
  ]);

  throwIfAborted(signal);
  await putJson(
    env,
    "recommend.json",
    {
      generated_at: now,
      recommended: recommended.results ?? [],
      latest: latest.results ?? [],
      underrated: underrated.results ?? [],
      creators: creators.results ?? [],
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

  const [ownVideos, ownTotalRow, collabVideos, collabTotalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT ${STATIC_USER_PROFILE_VIDEO_SELECT}
       FROM videos AS v
       WHERE v.creator_x_user_id = ?
         AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
      .bind(xId, STATIC_USER_MAX_STATIC_ITEMS)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM videos AS v
       WHERE v.creator_x_user_id = ?
         AND ${COUNTABLE_PUBLIC_VIDEO_SQL}`,
    )
      .bind(xId)
      .first<{ c?: number }>(),
    env.DB.prepare(
      `SELECT ${STATIC_USER_COLLAB_VIDEO_SELECT}
       FROM videos AS v
       INNER JOIN video_members AS vm ON vm.video_id = v.id
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND LOWER(vm.x_user_id) = LOWER(?)
         AND LOWER(v.creator_x_user_id) <> LOWER(?)
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
      .bind(xId, xId, STATIC_USER_MAX_STATIC_ITEMS)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT v.id) AS c
       FROM videos AS v
       INNER JOIN video_members AS vm ON vm.video_id = v.id
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND LOWER(vm.x_user_id) = LOWER(?)
         AND LOWER(v.creator_x_user_id) <> LOWER(?)`,
    )
      .bind(xId, xId)
      .first<{ c?: number }>(),
  ]);

  throwIfAborted(signal);
  const ownItems = ownVideos.results ?? [];
  const collabItems = collabVideos.results ?? [];
  const ownTotal = Number(ownTotalRow?.c ?? ownItems.length);
  const collabTotal = Number(collabTotalRow?.c ?? collabItems.length);

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
