/**
 * 通知ディスパッチロジック。fast-jobs / notification-dispatcher から共通利用。
 */
export type Env = {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
  APP_ORIGIN?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

const MAX_RETRIES = 4;
const PROCESSING_STALE_SEC = 15 * 60;
const RETRY_BACKOFF_SEC = [60, 300, 900] as const;

type OutboxRow = {
  id: string;
  discord_user_id: string;
  type: string;
  payload_json: string;
  attempt_count: number;
};

export async function processNotificationQueue(
  env: Env,
  opts?: { limit?: number },
): Promise<{ processed: number; failed: number }> {
  const limit = opts?.limit ?? 50;
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'pending',
            processing_started_at = NULL,
            last_error = COALESCE(last_error, 'processing timeout rescue')
      WHERE status = 'processing'
        AND processing_started_at IS NOT NULL
        AND processing_started_at < ?1
        AND attempt_count < ?2`,
  )
    .bind(now - PROCESSING_STALE_SEC, MAX_RETRIES)
    .run();

  const result = await env.DB.prepare(
    `SELECT id, discord_user_id, type, payload_json, attempt_count
       FROM notification_outbox
      WHERE status = 'pending'
        AND attempt_count < ?1
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?2)
      ORDER BY created_at ASC
      LIMIT ?3`,
  )
    .bind(MAX_RETRIES, now, limit)
    .all<OutboxRow>();

  const rows = result.results ?? [];
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await env.DB.prepare(
        `UPDATE notification_outbox
            SET status = 'processing',
                processing_started_at = ?1
          WHERE id = ?2 AND status = 'pending'`,
      )
        .bind(now, row.id)
        .run();

      const webhookUrl = env.DISCORD_WEBHOOK_URL;
      const botToken = env.DISCORD_BOT_TOKEN;

      if (webhookUrl) {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: row.payload_json,
        });
        if (!res.ok) throw new Error(`webhook ${res.status}`);
      } else if (botToken && row.discord_user_id) {
        const dmUrl = `https://discord.com/api/v10/users/${row.discord_user_id}/messages`;
        const res = await fetch(dmUrl, {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: row.payload_json,
        });
        if (!res.ok) throw new Error(`dm ${res.status}`);
      }

      await env.DB.prepare(
        `UPDATE notification_outbox SET status = 'sent', processing_started_at = NULL WHERE id = ?1 AND status = 'processing'`,
      )
        .bind(row.id)
        .run();
      processed++;
    } catch (e) {
      failed++;
      const nextAttempt =
        row.attempt_count < RETRY_BACKOFF_SEC.length
          ? now + RETRY_BACKOFF_SEC[row.attempt_count]
          : null;
      const nextStatus =
        row.attempt_count + 1 >= MAX_RETRIES ? "failed" : "pending";
      await env.DB.prepare(
        `UPDATE notification_outbox
            SET attempt_count = ?1,
                status = ?2,
                processing_started_at = NULL,
                last_error = ?3,
                next_attempt_at = ?4
          WHERE id = ?5`,
      )
        .bind(
          row.attempt_count + 1,
          nextStatus,
          String(e).slice(0, 500),
          nextAttempt,
          row.id,
        )
        .run();
    }
  }

  return { processed, failed };
}
