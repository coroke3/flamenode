/**
 * 通知ディスパッチャー。
 * notification_outbox テーブルから未送信レコードを取り、Discord DM や Webhook に投げる。
 * 失敗時はリトライ最大3回でステータスを更新する。
 *
 * Opus判断候補: notification_outbox のカラム構成 (discord_user_id, type, payload_json,
 * status, attempt_count, next_attempt_at, last_error) は Worker が想定していた
 * (channel, payload, retry_count, sent_at) と大きく異なる。
 * 実クエリの修正は Opus レビュー後に行うこと。現在は SELECT/UPDATE クエリをコメントアウトし
 * ディスパッチ処理をスキップする安全実装にしてある。
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
  // Opus判断候補: notification_outbox のカラム (discord_user_id, type, payload_json,
  // status, attempt_count, next_attempt_at, last_error) に合わせてクエリを再設計すること。
  // 旧カラム名 (channel, payload, retry_count, sent_at) は存在しないため、
  // クエリを実行すると実行時エラーになる。修正完了まで dispatch をスキップする。
  //
  // 旧クエリ (参考):
  // SELECT id, channel, payload, retry_count
  //   FROM notification_outbox   -- テーブル名修正済み (旧: notifications)
  //   WHERE status = 'pending' AND retry_count < ?1
  //   ORDER BY created_at ASC LIMIT 50
  //
  // UPDATE notification_outbox SET status = 'sent', sent_at = ?1, updated_at = ?1 WHERE id = ?2
  // UPDATE notification_outbox SET retry_count = ?1, status = ?2, updated_at = ?3 WHERE id = ?4
  //
  // 上記 SQL はカラム名不一致のため無効。Opus レビュー後に実装すること。
  void env; // lint: unused variable suppression
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
