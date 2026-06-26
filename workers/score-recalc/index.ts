/**
 * video_stats.score の再計算ワーカー。
 * 設計: いいね数 + 再生数 + 直近期間の活動度から score を計算し、
 * トップページのおすすめ・関連動画の並びに反映する。
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
  // 軽量な多項式: views * 1 + likes * 5 + age_decay
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO video_stats (
       video_id, app_view_count, app_like_count, trending_view_count_24h, score, updated_at
     )
     SELECT
       v.id,
       COALESCE(vs.app_view_count, 0),
       COALESCE(vs.app_like_count, 0),
       COALESCE(vs.trending_view_count_24h, 0),
       COALESCE(ym.view_count, 0) * 1.0
         + COALESCE(vs.app_like_count, 0) * 5.0
         - MAX(0, (?1 - COALESCE(v.scheduled_time, ?1))) / 86400.0 * 0.1,
       ?1
     FROM videos v
     LEFT JOIN video_stats vs ON vs.video_id = v.id
     LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
     WHERE v.visibility_status = 'public'
     ON CONFLICT(video_id) DO UPDATE SET
       app_view_count = excluded.app_view_count,
       app_like_count = excluded.app_like_count,
       trending_view_count_24h = excluded.trending_view_count_24h,
       score = excluded.score,
       updated_at = excluded.updated_at`,
  )
    .bind(now)
    .run();

  // videos.score も同期する（クエリは videos.score を参照）
  await env.DB.prepare(
    `UPDATE videos SET score = (
       SELECT COALESCE(ym.view_count, 0) * 1.0
         + COALESCE(vs.app_like_count, 0) * 5.0
         - MAX(0, (?1 - COALESCE(v.scheduled_time, ?1))) / 86400.0 * 0.1
       FROM video_stats vs
       LEFT JOIN video_youtube_metadata ym ON ym.video_id = vs.video_id
       WHERE vs.video_id = videos.id
     )
     WHERE visibility_status = 'public'`,
  )
    .bind(now)
    .run();
}
