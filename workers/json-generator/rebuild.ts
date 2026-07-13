import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  cacheControlForFreshness,
  resolveEventFreshness,
} from "./freshness.ts";

type Env = { DB: D1Database; R2: R2Bucket; KV: KVNamespace };
type ArtifactTarget = { targetType: string; targetId: string; sourceUpdatedAt?: number | null };
type ArtifactRow = { object_key: string };
const STATIC_ARTIFACT_SCHEMA_VERSION = 1;

const EVENT_INDEX_COLUMNS = `
  id, title, explanation, icon_url, img_url, accent_color,
  event_type, slot_type, slot_visibility_mode,
  max_slots_per_video, max_consecutive_slots_per_entry,
  start_time, end_time, entry_start_time, entry_end_time,
  visibility_status, created_at
`;

const PVSF_SUMMARY_EVENT_ID = "PVSFSummary";

export async function rebuildTarget(
  env: Env,
  targetType: string,
  targetId: string,
): Promise<void> {
  switch (targetType) {
    case "top":
      await rebuildTop(env);
      break;
    case "list_recent":
      await rebuildListRecent(env);
      break;
    case "events_index":
      await rebuildEventsIndex(env);
      break;
    case "search_index":
      await rebuildSearchIndexLite(env);
      break;
    case "event":
      await rebuildEvent(env, targetId);
      break;
    case "video":
      await rebuildVideo(env, targetId);
      break;
    case "user":
      await rebuildUser(env, targetId);
      break;
    case "list_popular":
      await rebuildListPopular(env);
      break;
    default:
      throw new Error(`Unknown target_type: ${targetType}`);
  }
  if (["top", "list_recent", "list_popular", "events_index", "search_index"].includes(targetType)) {
    const keys: Record<string, string> = {
      top: "top.json",
      list_recent: "list/recent.json",
      list_popular: "list/popular.json",
      events_index: "events/index.json",
      search_index: "search-index-lite.json",
    };
    await reconcileTrackedArtifacts(
      env,
      { targetType, targetId: "global" },
      [keys[targetType]],
    );
  }
}

async function putJson(
  env: Env,
  key: string,
  body: unknown,
  cacheControl: string,
  target?: ArtifactTarget,
): Promise<void> {
  assertNoForbiddenPublicKeys(body);
  const serialized = JSON.stringify(body);
  await env.R2.put(key, serialized, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl,
    },
  });
  if (target) await recordArtifact(env, target, key, serialized);
}

async function recordArtifact(
  env: Env,
  target: ArtifactTarget,
  objectKey: string,
  body: string,
): Promise<void> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const contentHash = Array.from(new Uint8Array(hashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
}

export async function removeTrackedArtifacts(
  env: Env,
  targetType: string,
  targetId: string,
  limit = 20,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT object_key FROM static_artifacts
     WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
     ORDER BY generated_at ASC LIMIT ?`,
  ).bind(targetType, targetId, limit).all<ArtifactRow>();
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows.results ?? []) {
    await env.R2.delete(row.object_key);
    await env.DB.prepare(
      `UPDATE static_artifacts SET deleted_at = ?
       WHERE target_type = ? AND target_id = ? AND object_key = ? AND deleted_at IS NULL`,
    ).bind(now, targetType, targetId, row.object_key).run();
  }
  return rows.results?.length ?? 0;
}

async function reconcileTrackedArtifacts(
  env: Env,
  target: ArtifactTarget,
  liveKeys: readonly string[],
  limit = 20,
): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT object_key FROM static_artifacts
     WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
       AND object_key NOT IN (${liveKeys.length ? liveKeys.map(() => "?").join(",") : "NULL"})
     ORDER BY generated_at ASC LIMIT ?`,
  ).bind(target.targetType, target.targetId, ...liveKeys, limit).all<ArtifactRow>();
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows.results ?? []) {
    await env.R2.delete(row.object_key);
    await env.DB.prepare(
      `UPDATE static_artifacts SET deleted_at = ?
       WHERE target_type = ? AND target_id = ? AND object_key = ? AND deleted_at IS NULL`,
    ).bind(now, target.targetType, target.targetId, row.object_key).run();
  }
}

async function rebuildTop(env: Env): Promise<void> {
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
              primary_event_id,
              scheduled_time,
              visibility_status AS status,
              part
       FROM videos
       WHERE visibility_status = 'public'
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
              primary_event_id,
              scheduled_time,
              visibility_status AS status,
              part
       FROM videos
       WHERE visibility_status = 'public'
       ORDER BY scheduled_time DESC
       LIMIT 30`,
    ).all(),
    env.DB.prepare(
      `SELECT ${EVENT_INDEX_COLUMNS}
       FROM events
       WHERE visibility_status = 'public'
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
       WHERE visibility_status IN ('public', 'archived')
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
         WHERE xu.approval_status IN ('approved', 'pending')
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
      `SELECT event_id,
              SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
              COUNT(*) AS total
       FROM slots
       GROUP BY event_id`,
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
       WHERE approval_status IN ('approved', 'pending')`,
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
      creators: Number(creatorCount?.c ?? creators.results?.length ?? 0),
    },
  };
  await putJson(env, "top.json", payload, "public, max-age=60, stale-while-revalidate=300", { targetType: "top", targetId: "global" });
  await env.KV.put(
    "static:top",
    JSON.stringify({
      generated_at: payload.generated_at,
      count: payload.latest.length,
      active_events: payload.active_events.length,
    }),
    { expirationTtl: 600 },
  );
}

async function rebuildListRecent(env: Env): Promise<void> {
  const [rows, totalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, youtube_video_id,
              creator_display_name AS display_name,
              creator_display_name,
              creator_x_user_id,
              creator_icon_url AS icon_url,
              creator_icon_url,
              primary_event_id,
              scheduled_time,
              visibility_status AS status
     FROM videos WHERE visibility_status = 'public'
     ORDER BY scheduled_time DESC LIMIT 120`,
    ).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c FROM videos WHERE visibility_status = 'public'`,
    ).first<{ c?: number }>(),
  ]);
  await putJson(env, "list/recent.json", {
    generated_at: Math.floor(Date.now() / 1000),
    total: Number(totalRow?.c ?? rows.results?.length ?? 0),
    items: rows.results ?? [],
  }, "public, max-age=120, stale-while-revalidate=600", { targetType: "list_recent", targetId: "global" });
}

async function rebuildListPopular(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT v.id, v.title, v.youtube_video_id, v.creator_display_name,
            COALESCE(v.score, 0) AS score
     FROM videos v
     WHERE v.visibility_status = 'public'
     ORDER BY score DESC, v.scheduled_time DESC
     LIMIT 60`,
  ).all();
  await putJson(env, "list/popular.json", {
    generated_at: Math.floor(Date.now() / 1000),
    items: rows.results ?? [],
  }, "public, max-age=300, stale-while-revalidate=1800", { targetType: "list_popular", targetId: "global" });
}

async function rebuildEventsIndex(env: Env): Promise<void> {
  const [rows, groupSections] = await Promise.all([
    env.DB.prepare(
      `SELECT ${EVENT_INDEX_COLUMNS}
     FROM events
     WHERE visibility_status IN ('public', 'archived')
     ORDER BY start_time DESC
     LIMIT 200`,
    ).all(),
    rebuildEventGroupSections(env),
  ]);
  await putJson(env, "events/index.json", {
    generated_at: Math.floor(Date.now() / 1000),
    items: rows.results ?? [],
    group_sections: groupSections,
  }, "public, max-age=300, stale-while-revalidate=1800", { targetType: "events_index", targetId: "global" });
}

async function rebuildEventGroupSections(env: Env): Promise<unknown[]> {
  const groups = await env.DB.prepare(
    `SELECT id, slug, name, description, group_type, icon_url, accent_color, sort_order
     FROM event_groups
     WHERE visibility_status = 'public'
     ORDER BY sort_order ASC, name ASC`,
  ).all<Record<string, unknown>>();
  const groupRows = groups.results ?? [];
  if (groupRows.length === 0) return [];

  const groupIds = groupRows
    .map((group) => String(group.id ?? "").trim())
    .filter(Boolean);
  if (groupIds.length === 0) return [];

  const placeholders = groupIds.map(() => "?").join(",");
  const eventsByGroup = new Map<string, Record<string, unknown>[]>();

  const junctionRows = await env.DB.prepare(
    `SELECT ege.event_group_id AS group_id, ${EVENT_INDEX_COLUMNS
      .split(",")
      .map((column) => `e.${column.trim()}`)
      .join(", ")}
     FROM event_group_events ege
     INNER JOIN events e ON e.id = ege.event_id
     WHERE ege.event_group_id IN (${placeholders})
       AND e.visibility_status IN ('public', 'archived')
     ORDER BY e.start_time DESC, e.id ASC`,
  )
    .bind(...groupIds)
    .all<Record<string, unknown>>();
  for (const row of junctionRows.results ?? []) {
    mergeGroupEvent(eventsByGroup, row.group_id, stripGroupId(row));
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

async function rebuildSearchIndexLite(env: Env): Promise<void> {
  const videos = await env.DB.prepare(
    `SELECT id, title, creator_display_name, creator_x_user_id, youtube_video_id
     FROM videos WHERE visibility_status = 'public'
     ORDER BY updated_at DESC LIMIT 500`,
  ).all();
  const users = await env.DB.prepare(
    `SELECT id, x_name FROM x_users
     WHERE approval_status = 'approved'
     ORDER BY approval_requested_at DESC, id ASC LIMIT 500`,
  ).all();
  await putJson(env, "search-index-lite.json", {
    generated_at: Math.floor(Date.now() / 1000),
    videos: videos.results ?? [],
    users: users.results ?? [],
  }, "public, max-age=600, stale-while-revalidate=3600", { targetType: "search_index", targetId: "global" });
}

async function rebuildEvent(env: Env, eventId: string): Promise<void> {
  const ev = (
    await env.DB.prepare(
      `SELECT id, title, explanation, icon_url, img_url, accent_color,
              start_time, end_time, entry_start_time, entry_end_time,
              visibility_status, updated_at
       FROM events WHERE id = ? LIMIT 1`,
    )
      .bind(eventId)
      .first()
  ) as Record<string, unknown> | null;
  if (!ev) {
    await removeTrackedArtifacts(env, "event", eventId);
    return;
  }
  const visibility = String(ev.visibility_status ?? "");
  if (visibility !== "public" && visibility !== "archived") {
    await removeTrackedArtifacts(env, "event", eventId);
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

  const staff = await env.DB.prepare(
    `SELECT es.role, es.display_name, es.public_role_label,
            xu.id AS x_user_id, xu.x_name, xu.icon_url
     FROM event_staff es
     LEFT JOIN x_users xu ON xu.id = es.x_user_id
     WHERE es.event_id = ? AND es.is_public = 1
     ORDER BY es.created_at ASC`,
  )
    .bind(eventId)
    .all();

  const slotSummary = await env.DB.prepare(
    `SELECT status, COUNT(*) AS c FROM slots WHERE event_id = ? GROUP BY status`,
  )
    .bind(eventId)
    .all();

  const publicVideos = await env.DB.prepare(
    `SELECT v.id, v.title, v.youtube_video_id, v.creator_display_name,
            v.creator_x_user_id, v.creator_icon_url, v.visibility_status, v.scheduled_time
     FROM videos v
     INNER JOIN video_events ve ON ve.video_id = v.id
     WHERE ve.event_id = ? AND v.visibility_status = 'public'
     ORDER BY v.scheduled_time DESC
     LIMIT 500`,
  )
    .bind(eventId)
    .all();

  const payload = {
    generated_at: now,
    freshness,
    event: eventPayload,
    public_staff: staff.results ?? [],
    slots_summary: slotSummary.results ?? [],
    public_videos: publicVideos.results ?? [],
  };

  await putJson(
    env,
    `events/${eventId}.json`,
    payload,
    cacheControlForFreshness(freshness),
    { targetType: "event", targetId: eventId, sourceUpdatedAt: Number(ev.updated_at ?? 0) || null },
  );
  await reconcileTrackedArtifacts(env, { targetType: "event", targetId: eventId }, [`events/${eventId}.json`]);
}

async function rebuildVideo(env: Env, videoId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id, title, youtube_video_id, creator_display_name, creator_x_user_id,
            creator_icon_url, music, credit, intro_comment, highlights,
            production_story, closing_comment, visibility_status, scheduled_time,
            primary_event_id, collaboration_type, part, updated_at
     FROM videos
     WHERE id = ? OR youtube_video_id = ?
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  )
    .bind(videoId, videoId, videoId)
    .first();
  if (!row) {
    await removeTrackedArtifacts(env, "video", videoId);
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
  if (videoVisibility !== "public" && videoVisibility !== "limited") {
    await removeTrackedArtifacts(env, "video", internalVideoId);
    return;
  }

  const events = await env.DB.prepare(
    `SELECT event_id FROM video_events WHERE video_id = ?`,
  )
    .bind(internalVideoId)
    .all();

  const members = await env.DB.prepare(
    `SELECT name AS display_name, x_user_id, role AS role_label, order_index
     FROM video_members WHERE video_id = ? AND is_public_member = 1
     ORDER BY order_index ASC`,
  )
    .bind(internalVideoId)
    .all();

  const payload = {
    generated_at: Math.floor(Date.now() / 1000),
    video: row,
    event_ids: (events.results ?? []).map((r) => (r as { event_id: string }).event_id),
    public_members: members.results ?? [],
  };

  await putJson(
    env,
    `videos/${internalVideoId}.json`,
    payload,
    "public, max-age=300, stale-while-revalidate=1800",
    videoTarget,
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
    );
  }
  await reconcileTrackedArtifacts(env, videoTarget, [
    `videos/${internalVideoId}.json`,
    ...(youtubeVideoId && youtubeVideoId !== internalVideoId ? [`videos/${youtubeVideoId}.json`] : []),
  ]);
}

async function rebuildUser(env: Env, xId: string): Promise<void> {
  const user = await env.DB.prepare(
    `SELECT id, x_name, icon_url, profile_text, portfolio_contact,
            youtube_channel_url, other_social_links, updated_at
     FROM x_users WHERE id = ? AND approval_status = 'approved' LIMIT 1`,
  )
    .bind(xId)
    .first();
  if (!user) {
    await removeTrackedArtifacts(env, "user", xId);
    return;
  }

  const [recentVideos, totalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, youtube_video_id,
              creator_display_name AS display_name,
              creator_display_name,
              creator_x_user_id,
              creator_icon_url AS icon_url,
              creator_icon_url,
              primary_event_id,
              scheduled_time,
              visibility_status AS status,
              part
     FROM videos
     WHERE creator_x_user_id = ? AND visibility_status = 'public'
     ORDER BY scheduled_time DESC LIMIT 120`,
    )
      .bind(xId)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM videos
       WHERE creator_x_user_id = ? AND visibility_status = 'public'`,
    )
      .bind(xId)
      .first<{ c?: number }>(),
  ]);

  await putJson(env, `users/${xId}.json`, {
    generated_at: Math.floor(Date.now() / 1000),
    user,
    total_works: Number(totalRow?.c ?? recentVideos.results?.length ?? 0),
    recent_videos: recentVideos.results ?? [],
  }, "public, max-age=600, stale-while-revalidate=3600", { targetType: "user", targetId: xId, sourceUpdatedAt: Number((user as { updated_at?: unknown }).updated_at ?? 0) || null });
  await reconcileTrackedArtifacts(env, { targetType: "user", targetId: xId }, [`users/${xId}.json`]);
}
