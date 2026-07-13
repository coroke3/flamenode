/**
 * 通知outboxのbounded dispatcher。background-jobsの高速レーンから呼び出す。
 */
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
/** 最悪時でもDiscord 18回、D1 24回程度に収める。 */
export const MAX_NOTIFICATION_BATCH = 6;

type OutboxRow = {
  id: string;
  recipient_user_id: string;
  discord_id: string | null;
  discord_dm_channel_id: string | null;
  type: string;
  payload_json: string;
  attempt_count: number;
};

type DeliveryResult = {
  delivered: boolean;
  dmChannelId?: string;
};

function boundedLimit(value: unknown): number {
  const requested = Number(value ?? MAX_NOTIFICATION_BATCH);
  if (!Number.isFinite(requested)) return MAX_NOTIFICATION_BATCH;
  return Math.min(MAX_NOTIFICATION_BATCH, Math.max(1, Math.floor(requested)));
}

/** 古いleaseを有限件だけ救済し、再試行枯渇分はdead_letterに固定する。 */
async function recoverExpiredLeases(env: Env, now: number, limit: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'pending',
            processing_started_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
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
        SET status = 'dead_letter',
            processing_started_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
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
        SET status = 'processing',
            processing_started_at = ?1,
            lease_token = ?2,
            lease_expires_at = ?3
      WHERE id = ?4
        AND status = 'pending'
        AND COALESCE(attempt_count, 0) < ?5
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)`,
  )
    .bind(now, token, now + PROCESSING_LEASE_SEC, row.id, MAX_RETRIES)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function markSent(env: Env, rowId: string, token: string, now: number): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'sent',
            processing_started_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            next_attempt_at = NULL,
            last_error = NULL,
            processed_at = ?1
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
  const attempts = Math.max(0, Number(row.attempt_count) || 0) + 1;
  const deadLetter = attempts >= MAX_RETRIES;
  const delay = RETRY_BACKOFF_SEC[Math.min(attempts - 1, RETRY_BACKOFF_SEC.length - 1)] ?? 900;
  await env.DB.prepare(
    `UPDATE notification_outbox
        SET attempt_count = ?1,
            status = ?2,
            processing_started_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            next_attempt_at = ?3,
            last_error = ?4
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

async function cacheDmChannel(
  env: Env,
  userId: string,
  channelId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE "user"
     SET discord_dm_channel_id = ?1
     WHERE id = ?2
       AND discord_dm_channel_id IS NOT ?1`,
  )
    .bind(channelId, userId)
    .run();
}

/** 1 cronあたり最大6件。通常DMはキャッシュ済みchannelへ1 API呼び出しで送る。 */
export async function processNotificationQueue(
  env: Env,
  opts?: { limit?: number },
): Promise<{ processed: number; failed: number; skipped: number }> {
  const limit = boundedLimit(opts?.limit);
  const now = Math.floor(Date.now() / 1000);
  await recoverExpiredLeases(env, now, limit);

  const result = await env.DB.prepare(
    `SELECT n.id,
            n.recipient_user_id,
            u.discord_id,
            u.discord_dm_channel_id,
            n.type,
            n.payload_json,
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
      const delivery = await deliverInternal(
        {
          type: row.type,
          payload_json: row.payload_json,
          discord_id: row.discord_id ?? "",
          discord_dm_channel_id: row.discord_dm_channel_id,
        },
        env,
      );
      if (!delivery.delivered) {
        throw new Error("notification transport unavailable");
      }
      if (
        delivery.dmChannelId &&
        delivery.dmChannelId !== row.discord_dm_channel_id
      ) {
        await cacheDmChannel(
          env,
          row.recipient_user_id,
          delivery.dmChannelId,
        ).catch(() => undefined);
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

async function sendDiscordMessage(
  channelId: string,
  payloadJson: string,
  botToken: string,
): Promise<Response> {
  return fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: payloadJson,
  });
}

async function createDiscordDmChannel(
  discordId: string,
  botToken: string,
): Promise<string | null> {
  const response = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: discordId }),
  });
  if (!response.ok) return null;
  const channel = (await response.json()) as { id?: string };
  return channel.id?.trim() || null;
}

async function deliverInternal(
  row: {
    type: string;
    payload_json: string;
    discord_id: string;
    discord_dm_channel_id?: string | null;
  },
  env: Pick<Env, "DISCORD_WEBHOOK_URL" | "DISCORD_BOT_TOKEN">,
): Promise<DeliveryResult> {
  if (row.type === "discord_webhook") {
    if (!env.DISCORD_WEBHOOK_URL) return { delivered: false };
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: row.payload_json,
    });
    return { delivered: response.ok };
  }
  if (!env.DISCORD_BOT_TOKEN || !row.discord_id) {
    return { delivered: false };
  }

  const cachedChannel = row.discord_dm_channel_id?.trim();
  if (cachedChannel) {
    const cachedResponse = await sendDiscordMessage(
      cachedChannel,
      row.payload_json,
      env.DISCORD_BOT_TOKEN,
    );
    if (cachedResponse.ok) {
      return { delivered: true, dmChannelId: cachedChannel };
    }
    if (cachedResponse.status !== 404) {
      return { delivered: false };
    }
  }

  const channelId = await createDiscordDmChannel(
    row.discord_id,
    env.DISCORD_BOT_TOKEN,
  );
  if (!channelId) return { delivered: false };
  const response = await sendDiscordMessage(
    channelId,
    row.payload_json,
    env.DISCORD_BOT_TOKEN,
  );
  return {
    delivered: response.ok,
    ...(response.ok ? { dmChannelId: channelId } : {}),
  };
}

/** 既存の単体利用契約を維持するboolean wrapper。 */
export async function deliver(
  row: { type: string; payload_json: string; discord_id: string },
  env: Pick<Env, "DISCORD_WEBHOOK_URL" | "DISCORD_BOT_TOKEN">,
): Promise<boolean> {
  return (await deliverInternal(row, env)).delivered;
}
