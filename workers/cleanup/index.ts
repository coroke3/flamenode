/**
 * 期限切れスロット解放 / 古い通知削除 / 監査ログのアーカイブを担当するスケジュールワーカー。
 * 設計の `cleanup` ジョブに対応。
 */
export interface Env {
  DB: D1Database;
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCleanup(env));
  },
  async fetch(): Promise<Response> {
    return new Response("FlameNode cleanup", { status: 200 });
  },
};

async function runCleanup(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // 期限切れの slot.priority_reclaim_until を解放
  await env.DB.prepare(
    `UPDATE slots
     SET priority_reclaim_until = NULL, updated_at = ?1
     WHERE priority_reclaim_until IS NOT NULL AND priority_reclaim_until < ?1`,
  )
    .bind(now)
    .run();

  // 期限切れ x_reapply_required スロットを voided へ
  await env.DB.prepare(
    `UPDATE slots
     SET status = 'voided', updated_at = ?1
     WHERE status = 'x_reapply_required' AND deadline_at IS NOT NULL AND deadline_at < ?1`,
  )
    .bind(now)
    .run();
}
