/**
 * 通知ディスパッチャー。
 * notifications テーブルから未送信レコードを取り、Discord DM や Webhook に投げる。
 * 失敗時はリトライ最大3回でステータスを更新する。
 */
export interface Env {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
}

const MAX_RETRIES = 3;

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatch(env));
  },
  async fetch(): Promise<Response> {
    return new Response("FlameNode notification-dispatcher", { status: 200 });
  },
};

async function dispatch(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, channel, payload, retry_count
     FROM notifications
     WHERE status = 'pending' AND retry_count < ?1
     ORDER BY created_at ASC LIMIT 50`,
  )
    .bind(MAX_RETRIES)
    .all<{ id: string; channel: string; payload: string; retry_count: number }>();

  for (const row of rows.results ?? []) {
    const ok = await deliver(row, env).catch(() => false);
    const now = Math.floor(Date.now() / 1000);
    if (ok) {
      await env.DB.prepare(
        `UPDATE notifications SET status = 'sent', sent_at = ?1, updated_at = ?1 WHERE id = ?2`,
      )
        .bind(now, row.id)
        .run();
    } else {
      const newRetry = row.retry_count + 1;
      const status = newRetry >= MAX_RETRIES ? "failed" : "pending";
      await env.DB.prepare(
        `UPDATE notifications SET retry_count = ?1, status = ?2, updated_at = ?3 WHERE id = ?4`,
      )
        .bind(newRetry, status, now, row.id)
        .run();
    }
  }
}

async function deliver(
  row: { channel: string; payload: string },
  env: Env,
): Promise<boolean> {
  if (row.channel === "discord_webhook" && env.DISCORD_WEBHOOK_URL) {
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: row.payload,
    });
    return res.ok;
  }
  return false;
}
