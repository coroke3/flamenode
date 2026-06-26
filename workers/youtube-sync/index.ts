/**
 * YouTube メタデータ同期ワーカー。
 * 公開済み動画の view_count や thumbnail_url、削除/限定公開状態を取得して更新する。
 * 設計: 1日数回、低コストで回す。クォータ枯渇に注意。
 */
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  YOUTUBE_API_KEY: string;
}

const BATCH = 50;

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncBatch(env));
  },
  async fetch(): Promise<Response> {
    return new Response("FlameNode youtube-sync", { status: 200 });
  },
};

export async function syncBatch(env: Env): Promise<void> {
  if (!env.YOUTUBE_API_KEY) return;
  const rows = await env.DB.prepare(
    `SELECT v.id, v.youtube_video_id
     FROM videos v
     LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
     WHERE v.youtube_video_id IS NOT NULL
       AND v.visibility_status NOT IN ('archived', 'voided')
     ORDER BY ym.synced_at ASC NULLS FIRST LIMIT ?1`,
  )
    .bind(BATCH)
    .all<{ id: string; youtube_video_id: string }>();
  const ids = (rows.results ?? []).map((r) => r.youtube_video_id).filter(Boolean);
  if (ids.length === 0) return;

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("key", env.YOUTUBE_API_KEY);
  url.searchParams.set("part", "statistics,status,contentDetails");
  url.searchParams.set("id", ids.join(","));
  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return;
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      statistics?: { viewCount?: string };
      status?: { privacyStatus?: string };
      contentDetails?: { duration?: string };
    }>;
  };

  const now = Math.floor(Date.now() / 1000);
  for (const item of data.items ?? []) {
    await env.DB.prepare(
      `INSERT INTO video_youtube_metadata (
         video_id, youtube_video_id, youtube_privacy_status,
         youtube_availability_status, duration_seconds, view_count,
         synced_at, sync_status, updated_at
       )
       SELECT id, youtube_video_id, ?2, ?2, ?3, ?1, ?4, 'synced', ?4
       FROM videos
       WHERE youtube_video_id = ?5
       ON CONFLICT(video_id) DO UPDATE SET
         youtube_video_id = excluded.youtube_video_id,
         youtube_privacy_status = excluded.youtube_privacy_status,
         youtube_availability_status = excluded.youtube_availability_status,
         duration_seconds = excluded.duration_seconds,
         view_count = excluded.view_count,
         synced_at = excluded.synced_at,
         sync_status = 'synced',
         sync_error = NULL,
         updated_at = excluded.updated_at`,
    )
      .bind(
        Number(item.statistics?.viewCount ?? 0),
        item.status?.privacyStatus ?? null,
        parseDuration(item.contentDetails?.duration ?? ""),
        now,
        item.id,
      )
      .run();
  }

  await env.KV.put(
    "youtube_sync:last",
    JSON.stringify({ at: now, count: data.items?.length ?? 0 }),
    { expirationTtl: 3600 },
  );
}

function parseDuration(iso: string): number {
  if (!iso) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + min * 60 + s;
}
