import { assertNoForbiddenPublicKeys } from "./sanitize";
import { cacheControlForFreshness, resolveEventFreshness } from "./freshness";

type Env = { DB: D1Database; R2: R2Bucket; KV: KVNamespace };

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
}

async function putJson(
  env: Env,
  key: string,
  body: unknown,
  cacheControl: string,
): Promise<void> {
  assertNoForbiddenPublicKeys(body);
  await env.R2.put(key, JSON.stringify(body), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl,
    },
  });
}

async function rebuildTop(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, title, youtube_video_id, creator_display_name AS display_name,
            creator_icon_url AS icon_url, scheduled_time
     FROM videos WHERE visibility_status = 'public'
     ORDER BY scheduled_time DESC LIMIT 60`,
  ).all();
  const payload = { generated_at: Math.floor(Date.now() / 1000), items: rows.results ?? [] };
  await putJson(env, "top.json", payload, "public, max-age=60, stale-while-revalidate=300");
  await env.KV.put(
    "static:top",
    JSON.stringify({ generated_at: payload.generated_at, count: rows.results?.length ?? 0 }),
    { expirationTtl: 600 },
  );
}

async function rebuildListRecent(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, title, youtube_video_id, creator_display_name, creator_x_user_id,
            creator_icon_url, scheduled_time
     FROM videos WHERE visibility_status = 'public'
     ORDER BY scheduled_time DESC LIMIT 120`,
  ).all();
  await putJson(env, "list/recent.json", {
    generated_at: Math.floor(Date.now() / 1000),
    items: rows.results ?? [],
  }, "public, max-age=120, stale-while-revalidate=600");
}

async function rebuildListPopular(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT v.id, v.title, v.youtube_video_id, v.creator_display_name,
            COALESCE(s.score, 0) AS score
     FROM videos v
     LEFT JOIN video_stats s ON s.video_id = v.id
     WHERE v.visibility_status = 'public'
     ORDER BY score DESC, v.scheduled_time DESC
     LIMIT 60`,
  ).all();
  await putJson(env, "list/popular.json", {
    generated_at: Math.floor(Date.now() / 1000),
    items: rows.results ?? [],
  }, "public, max-age=300, stale-while-revalidate=1800");
}

async function rebuildEventsIndex(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, title, explanation, icon_url, img_url, accent_color,
            start_time, end_time, is_active, is_entry_open, is_archived
     FROM events
     WHERE is_archived = 0
     ORDER BY start_time DESC
     LIMIT 200`,
  ).all();
  await putJson(env, "events/index.json", {
    generated_at: Math.floor(Date.now() / 1000),
    items: rows.results ?? [],
  }, "public, max-age=300, stale-while-revalidate=1800");
}

async function rebuildSearchIndexLite(env: Env): Promise<void> {
  const videos = await env.DB.prepare(
    `SELECT id, title, creator_display_name, creator_x_user_id, youtube_video_id
     FROM videos WHERE visibility_status IN ('public', 'limited')
     ORDER BY updated_at DESC LIMIT 500`,
  ).all();
  const users = await env.DB.prepare(
    `SELECT id, x_name FROM x_users
     WHERE approval_status = 'approved'
     ORDER BY updated_at DESC LIMIT 500`,
  ).all();
  await putJson(env, "search-index-lite.json", {
    generated_at: Math.floor(Date.now() / 1000),
    videos: videos.results ?? [],
    users: users.results ?? [],
  }, "public, max-age=600, stale-while-revalidate=3600");
}

async function rebuildEvent(env: Env, eventId: string): Promise<void> {
  const ev = (
    await env.DB.prepare(
      `SELECT id, title, explanation, icon_url, img_url, accent_color,
              start_time, end_time, is_active, is_entry_open, is_archived
       FROM events WHERE id = ? LIMIT 1`,
    )
      .bind(eventId)
      .first()
  ) as Record<string, unknown> | null;
  if (!ev) throw new Error(`Event not found: ${eventId}`);

  const now = Math.floor(Date.now() / 1000);
  const freshness = resolveEventFreshness(
    {
      is_active: Number(ev.is_active ?? 0),
      is_entry_open: Number(ev.is_entry_open ?? 0),
      is_archived: Number(ev.is_archived ?? 0),
      start_time: (ev.start_time as number | null) ?? null,
      end_time: (ev.end_time as number | null) ?? null,
    },
    now,
  );

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
     WHERE ve.event_id = ? AND v.visibility_status IN ('public', 'limited')
     ORDER BY v.scheduled_time DESC
     LIMIT 500`,
  )
    .bind(eventId)
    .all();

  const payload = {
    generated_at: now,
    freshness,
    event: ev,
    public_staff: staff.results ?? [],
    slots_summary: slotSummary.results ?? [],
    public_videos: publicVideos.results ?? [],
  };

  await putJson(
    env,
    `events/${eventId}.json`,
    payload,
    cacheControlForFreshness(freshness),
  );
}

async function rebuildVideo(env: Env, videoId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id, title, youtube_video_id, creator_display_name, creator_x_user_id,
            creator_icon_url, music, credit, intro_comment, highlights,
            production_story, closing_comment, visibility_status, scheduled_time,
            primary_event_id, collaboration_type, part
     FROM videos WHERE id = ? LIMIT 1`,
  )
    .bind(videoId)
    .first();
  if (!row) throw new Error(`Video not found: ${videoId}`);

  const events = await env.DB.prepare(
    `SELECT event_id FROM video_events WHERE video_id = ?`,
  )
    .bind(videoId)
    .all();

  const members = await env.DB.prepare(
    `SELECT display_name, x_user_id, role_label, order_index
     FROM video_members WHERE video_id = ? AND is_public_member = 1
     ORDER BY order_index ASC`,
  )
    .bind(videoId)
    .all();

  const payload = {
    generated_at: Math.floor(Date.now() / 1000),
    video: row,
    event_ids: (events.results ?? []).map((r) => (r as { event_id: string }).event_id),
    public_members: members.results ?? [],
  };

  await putJson(
    env,
    `videos/${videoId}.json`,
    payload,
    "public, max-age=300, stale-while-revalidate=1800",
  );
}

async function rebuildUser(env: Env, xId: string): Promise<void> {
  const user = await env.DB.prepare(
    `SELECT id, x_name, icon_url, profile_text, portfolio_contact,
            youtube_channel_url, other_social_links
     FROM x_users WHERE id = ? AND approval_status = 'approved' LIMIT 1`,
  )
    .bind(xId)
    .first();
  if (!user) throw new Error(`User not found: ${xId}`);

  const recentVideos = await env.DB.prepare(
    `SELECT id, title, youtube_video_id, scheduled_time
     FROM videos
     WHERE creator_x_user_id = ? AND visibility_status = 'public'
     ORDER BY scheduled_time DESC LIMIT 24`,
  )
    .bind(xId)
    .all();

  await putJson(env, `users/${xId}.json`, {
    generated_at: Math.floor(Date.now() / 1000),
    user,
    recent_videos: recentVideos.results ?? [],
  }, "public, max-age=600, stale-while-revalidate=3600");
}
