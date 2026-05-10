/**
 * video_score の再計算ワーカー。
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

async function recalcAll(env: Env): Promise<void> {
  // 軽量な多項式: views * 1 + likes * 5 + age_decay
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE videos
     SET video_score = (
       COALESCE(youtube_view_count, 0) * 1.0
       + COALESCE(likes_count, 0) * 5.0
       - MAX(0, (?1 - COALESCE(scheduled_time, ?1))) / 86400.0 * 0.1
     ),
       updated_at = ?1
     WHERE status = 'public' AND is_deleted = 0`,
  )
    .bind(now)
    .run();
}
