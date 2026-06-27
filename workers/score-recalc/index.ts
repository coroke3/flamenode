/**
 * Recalculates videos.score from the canonical videos columns and YouTube metadata.
 */
export interface Env {
  DB: D1Database;
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(recalcAll(env));
  },
  async fetch(): Promise<Response> {
    return new Response("FlameNode score-recalc", { status: 200 });
  },
};

export async function recalcAll(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE videos
     SET score =
       COALESCE((
         SELECT ym.view_count
         FROM video_youtube_metadata ym
         WHERE ym.video_id = videos.id
       ), 0) * 1.0
       + COALESCE(app_like_count, 0) * 5.0
       + COALESCE(trending_view_count_24h, 0) * 0.5
       - MAX(0, (?1 - COALESCE(scheduled_time, ?1))) / 86400.0 * 0.1,
       updated_at = ?1
     WHERE visibility_status = 'public'`,
  )
    .bind(now)
    .run();
}
