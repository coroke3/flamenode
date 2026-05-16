/**
 * 通知ディスパッチャー。
 * notification_outbox テーブルから未送信レコードを取り、Discord DM や Webhook に投げる。
 * 失敗時はリトライ最大 MAX_RETRIES 回でステータスを更新する。
 *
 * カラム: id, discord_user_id, type, payload_json, status, attempt_count,
 *         next_attempt_at, last_error, created_at
 * status enum: 'pending' | 'processing' | 'sent' | 'failed'
 * 時刻: Unix integer (Math.floor(Date.now() / 1000))
 */
export interface Env {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
}

const MAX_RETRIES = 3;
/** 指数バックオフ基数 (秒)。attempt_count=0 の初回失敗で 60 秒後にリトライ */
const BACKOFF_BASE_SEC = 60;

type OutboxRow = {
  id: string;
  discord_user_id: string;
  type: string;
  payload_json: string;
  attempt_count: number;
};

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatch(env));
  },
  async fetch(): Promise<Response> {
    return new Response("FlameNode notification-dispatcher", { status: 200 });
  },
};

async function dispatch(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const selectStmt = env.DB.prepare(
    `SELECT id, discord_user_id, type, payload_json, attempt_count
       FROM notification_outbox
      WHERE status = 'pending'
        AND attempt_count < ?1
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?2)
      ORDER BY created_at ASC
      LIMIT 50`,
  );

  const result = await selectStmt.bind(MAX_RETRIES, now).all<OutboxRow>();
  const rows = result.results ?? [];

  const markProcessingStmt = env.DB.prepare(
    `UPDATE notification_outbox SET status = 'processing' WHERE id = ?1`,
  );
  const markSentStmt = env.DB.prepare(
    `UPDATE notification_outbox SET status = 'sent' WHERE id = ?1`,
  );
  const markRetryStmt = env.DB.prepare(
    `UPDATE notification_outbox
        SET attempt_count = ?1,
            status = 'pending',
            last_error = ?2,
            next_attempt_at = ?3
      WHERE id = ?4`,
  );
  const markFailedStmt = env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'failed',
            attempt_count = ?1,
            last_error = ?2
      WHERE id = ?3`,
  );

  for (const row of rows) {
    await markProcessingStmt.bind(row.id).run();

    let ok = false;
    let errorMsg = "";
    try {
      ok = await deliver(
        { type: row.type, payload_json: row.payload_json, discord_user_id: row.discord_user_id },
        env,
      );
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    if (ok) {
      await markSentStmt.bind(row.id).run();
    } else {
      const nextCount = row.attempt_count + 1;
      if (nextCount >= MAX_RETRIES) {
        await markFailedStmt.bind(nextCount, errorMsg || "delivery failed", row.id).run();
      } else {
        const backoffSec = BACKOFF_BASE_SEC * Math.pow(2, row.attempt_count);
        const nextAttemptAt = Math.floor(Date.now() / 1000) + backoffSec;
        await markRetryStmt
          .bind(nextCount, errorMsg || "delivery failed", nextAttemptAt, row.id)
          .run();
      }
    }
  }
}

async function deliver(
  row: { type: string; payload_json: string; discord_user_id: string },
  env: Env,
): Promise<boolean> {
  if (row.type === "discord_webhook" && env.DISCORD_WEBHOOK_URL) {
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: row.payload_json,
    });
    return res.ok;
  }

  if (row.type === "discord_dm" && env.DISCORD_BOT_TOKEN) {
    // Discord DM: まずチャンネルを作成してからメッセージを送信する
    const dmChannelRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ recipient_id: row.discord_user_id }),
    });
    if (!dmChannelRes.ok) return false;

    const dmChannel = await dmChannelRes.json<{ id: string }>();
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: row.payload_json,
    });
    return msgRes.ok;
  }

  return false;
}
