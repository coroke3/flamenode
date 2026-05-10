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

async function syncBatch(env: Env): Promise<void> {
  if (!env.YOUTUBE_API_KEY) return;
  const rows = await env.DB.prepare(
    `SELECT id, youtube_video_id FROM videos
     WHERE youtube_video_id IS NOT NULL AND is_deleted = 0
     ORDER BY youtube_synced_at ASC NULLS FIRST LIMIT ?1`,
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
      `UPDATE videos
       SET youtube_view_count = ?1, youtube_status = ?2, youtube_duration_seconds = ?3,
           youtube_synced_at = ?4, updated_at = ?4
       WHERE youtube_video_id = ?5`,
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
