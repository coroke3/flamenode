/**
 * 通知 outbox の bounded dispatcher。単独 Worker としては deploy せず、
 * fast-jobs からだけ呼び出す。
 */
import { nextAttemptNumber } from "../shared/queue.ts";
import { safeErrorSummary } from "../shared/safeLog.ts";

export type Env = {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
  APP_ORIGIN?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

const MAX_RETRIES = 4;
const PROCESSING_LEASE_SEC = 5 * 60;
const RETRY_BACKOFF_SEC = [60, 300, 900] as const;
/**
 * Free plan の1実行50 subrequestsに収める。
 * 1件あたり claim + Discord最大2回 + 完了更新の最大4 subrequestsを使うため、
 * lease救済・一覧取得を含めても余裕が残る6件を上限とする。
 */
export const MAX_NOTIFICATION_BATCH = 6;

type OutboxRow = {
  id: string;
  recipient_user_id: string;
  discord_id: string | null;
  type: string;
  payload_json: string;
  attempt_count: number;
};

function boundedLimit(value: unknown): number {
  const requested = Number(value ?? MAX_NOTIFICATION_BATCH);
  if (!Number.isFinite(requested)) return MAX_NOTIFICATION_BATCH;
  return Math.min(
    MAX_NOTIFICATION_BATCH,
    Math.max(1, Math.floor(requested)),
  );
}

async function recoverExpiredLeases(
  env: Env,
  now: number,
  limit: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'pending', processing_started_at = NULL,
            lease_token = NULL, lease_expires_at = NULL,
            next_attempt_at = ?1,
            last_error = COALESCE(last_error, 'delivery lease expired')
      WHERE status = 'processing'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at <= ?1
        AND COALESCE(attempt_count, 0) < ?2
      LIMIT ?3`,
  )
    .bind(now, MAX_RETRIES, limit)
    .run();

  await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'dead_letter', processing_started_at = NULL,
            lease_token = NULL, lease_expires_at = NULL,
            last_error = COALESCE(last_error, 'delivery retry budget exhausted')
      WHERE status = 'processing'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at <= ?1
        AND COALESCE(attempt_count, 0) >= ?2
      LIMIT ?3`,
  )
    .bind(now, MAX_RETRIES, limit)
    .run();
}

async function claimOutboxRow(
  env: Env,
  row: OutboxRow,
  token: string,
  now: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'processing', processing_started_at = ?1,
            lease_token = ?2, lease_expires_at = ?3
      WHERE id = ?4 AND status = 'pending'
        AND COALESCE(attempt_count, 0) < ?5
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)`,
  )
    .bind(now, token, now + PROCESSING_LEASE_SEC, row.id, MAX_RETRIES)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function markSent(
  env: Env,
  rowId: string,
  token: string,
  now: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'sent', processing_started_at = NULL,
            lease_token = NULL, lease_expires_at = NULL,
            next_attempt_at = NULL, last_error = NULL, processed_at = ?1
      WHERE id = ?2 AND status = 'processing' AND lease_token = ?3`,
  )
    .bind(now, rowId, token)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function markDeliveryFailure(
  env: Env,
  row: OutboxRow,
  token: string,
  error: unknown,
  now: number,
): Promise<void> {
  const attempts = nextAttemptNumber(row.attempt_count);
  const deadLetter = attempts >= MAX_RETRIES;
  const delay =
    RETRY_BACKOFF_SEC[
      Math.min(attempts - 1, RETRY_BACKOFF_SEC.length - 1)
    ] ?? 900;
  await env.DB.prepare(
    `UPDATE notification_outbox
        SET attempt_count = ?1, status = ?2,
            processing_started_at = NULL, lease_token = NULL,
            lease_expires_at = NULL, next_attempt_at = ?3, last_error = ?4
      WHERE id = ?5 AND status = 'processing' AND lease_token = ?6`,
  )
    .bind(
      attempts,
      deadLetter ? "dead_letter" : "pending",
      deadLetter ? null : now + delay,
      safeErrorSummary(error),
      row.id,
      token,
    )
    .run();
}

export async function processNotificationQueue(
  env: Env,
  opts?: { limit?: number },
): Promise<{ processed: number; failed: number; skipped: number }> {
  const limit = boundedLimit(opts?.limit);
  const now = Math.floor(Date.now() / 1000);
  await recoverExpiredLeases(env, now, limit);
  const result = await env.DB.prepare(
    `SELECT n.id, n.recipient_user_id, u.discord_id, n.type, n.payload_json,
            COALESCE(n.attempt_count, 0) AS attempt_count
       FROM notification_outbox n
       INNER JOIN "user" u ON u.id = n.recipient_user_id
      WHERE n.status = 'pending'
        AND COALESCE(n.attempt_count, 0) < ?1
        AND (n.next_attempt_at IS NULL OR n.next_attempt_at <= ?2)
      ORDER BY n.created_at ASC, n.id ASC
      LIMIT ?3`,
  )
    .bind(MAX_RETRIES, now, limit)
    .all<OutboxRow>();

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of result.results ?? []) {
    const token = crypto.randomUUID();
    if (!(await claimOutboxRow(env, row, token, now))) {
      skipped += 1;
      continue;
    }
    try {
      if (!row.discord_id?.trim() && row.type !== "discord_webhook") {
        throw new Error("notification recipient has no Discord ID");
      }
      const delivered = await deliver(
        {
          type: row.type,
          payload_json: row.payload_json,
          discord_id: row.discord_id ?? "",
        },
        env,
      );
      if (!delivered) {
        throw new Error("notification transport unavailable");
      }
      if (await markSent(env, row.id, token, now)) processed += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      await markDeliveryFailure(env, row, token, error, now);
    }
  }
  return { processed, failed, skipped };
}

export async function deliver(
  row: { type: string; payload_json: string; discord_id: string },
  env: Pick<Env, "DISCORD_WEBHOOK_URL" | "DISCORD_BOT_TOKEN">,
): Promise<boolean> {
  if (row.type === "discord_webhook") {
    if (!env.DISCORD_WEBHOOK_URL) return false;
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: row.payload_json,
    });
    return response.ok;
  }
  if (!env.DISCORD_BOT_TOKEN || !row.discord_id) return false;
  const channelResponse = await fetch(
    "https://discord.com/api/v10/users/@me/channels",
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: row.discord_id }),
    },
  );
  if (!channelResponse.ok) return false;
  const channel = (await channelResponse.json()) as { id?: string };
  if (!channel.id) return false;
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channel.id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: row.payload_json,
    },
  );
  return response.ok;
}
