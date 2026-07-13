/**
 * 通知 outbox の bounded dispatcher。単独 Worker としては deploy せず、
 * fast-jobs からだけ呼び出す。
 */
import {
  cancelResponseBody,
  ExternalRequestBudget,
  fetchWithTimeout,
  parseRetryAfterMs,
  type FetchLike,
} from "../shared/externalApi.ts";
import { safeErrorSummary } from "../shared/safeLog.ts";

export type Env = {
  DB: D1Database;
  KV?: KVNamespace;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
  APP_ORIGIN?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

const MAX_RETRIES = 4;
const PROCESSING_LEASE_SEC = 5 * 60;
const RETRY_BACKOFF_SEC = [60, 300, 900] as const;
const DISCORD_FETCH_TIMEOUT_MS = 5_000;
const DISCORD_MAX_RETRY_AFTER_MS = 15 * 60 * 1_000;
const DISCORD_DM_CHANNEL_TTL_SEC = 30 * 24 * 60 * 60;
const DISCORD_DM_CHANNEL_CACHE_MAX = 1_000;
const DISCORD_GLOBAL_COOLDOWN_KEY = "discord:global";
/** 6件 × 未cache時最大2 request。inline retryは行わない。 */
export const MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN = 12;
/**
 * Free plan の1実行50 subrequestsに収める。
 * D1 claim/完了更新、KV channel cache、Discord最大2 requestを含めても余裕が残る。
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

type DeliveryOutcome = {
  ok: boolean;
  errorCode?: string;
  retryAfterSeconds?: number;
  permanent?: boolean;
};

type DiscordRequestResult =
  | { response: Response; deferred?: never }
  | { response?: never; deferred: DeliveryOutcome };

type DmChannelCacheEntry = {
  channelId: string;
  expiresAt: number;
};

const globalState = globalThis as typeof globalThis & {
  __flamenodeDiscordDmChannels?: Map<string, DmChannelCacheEntry>;
  __flamenodeDiscordCooldowns?: Map<string, number>;
};
const dmChannelCache =
  globalState.__flamenodeDiscordDmChannels ?? new Map<string, DmChannelCacheEntry>();
const discordCooldowns =
  globalState.__flamenodeDiscordCooldowns ?? new Map<string, number>();
globalState.__flamenodeDiscordDmChannels = dmChannelCache;
globalState.__flamenodeDiscordCooldowns = discordCooldowns;

function boundedLimit(value: unknown): number {
  const requested = Number(value ?? MAX_NOTIFICATION_BATCH);
  if (!Number.isFinite(requested)) return MAX_NOTIFICATION_BATCH;
  return Math.min(MAX_NOTIFICATION_BATCH, Math.max(1, Math.floor(requested)));
}

function pruneOldest<T>(map: Map<string, T>, maxSize: number): void {
  while (map.size > maxSize) {
    const first = map.keys().next().value as string | undefined;
    if (!first) return;
    map.delete(first);
  }
}

function dmCacheKey(discordId: string): string {
  return `external-api:discord:dm-channel:${discordId}`;
}

async function getCachedDmChannel(env: Env, discordId: string): Promise<string | null> {
  const now = Date.now();
  const local = dmChannelCache.get(discordId);
  if (local && local.expiresAt > now) {
    dmChannelCache.delete(discordId);
    dmChannelCache.set(discordId, local);
    return local.channelId;
  }
  if (local) dmChannelCache.delete(discordId);
  if (!env.KV) return null;
  try {
    const channelId = (await env.KV.get(dmCacheKey(discordId)))?.trim();
    if (!channelId) return null;
    dmChannelCache.set(discordId, {
      channelId,
      expiresAt: now + DISCORD_DM_CHANNEL_TTL_SEC * 1_000,
    });
    pruneOldest(dmChannelCache, DISCORD_DM_CHANNEL_CACHE_MAX);
    return channelId;
  } catch {
    return null;
  }
}

async function storeDmChannel(env: Env, discordId: string, channelId: string): Promise<void> {
  dmChannelCache.set(discordId, {
    channelId,
    expiresAt: Date.now() + DISCORD_DM_CHANNEL_TTL_SEC * 1_000,
  });
  pruneOldest(dmChannelCache, DISCORD_DM_CHANNEL_CACHE_MAX);
  if (!env.KV) return;
  try {
    await env.KV.put(dmCacheKey(discordId), channelId, {
      expirationTtl: DISCORD_DM_CHANNEL_TTL_SEC,
    });
  } catch {
    // cache保存失敗でも今回の配送は継続する。
  }
}

async function evictDmChannel(env: Env, discordId: string): Promise<void> {
  dmChannelCache.delete(discordId);
  if (!env.KV) return;
  try {
    await env.KV.delete(dmCacheKey(discordId));
  } catch {
    // 次回の404で再度回復できるためbest effort。
  }
}

function activeCooldownUntil(key: string, now: number): number {
  const until = discordCooldowns.get(key) ?? 0;
  if (until <= now) {
    discordCooldowns.delete(key);
    return 0;
  }
  return until;
}

function cooldownSeconds(routeKey: string, now = Date.now()): number {
  const until = Math.max(
    activeCooldownUntil(DISCORD_GLOBAL_COOLDOWN_KEY, now),
    activeCooldownUntil(routeKey, now),
  );
  return until > 0 ? Math.max(1, Math.ceil((until - now) / 1_000)) : 0;
}

function setCooldown(routeKey: string, delayMs: number): void {
  if (delayMs <= 0) return;
  discordCooldowns.set(routeKey, Date.now() + delayMs);
  pruneOldest(discordCooldowns, 512);
}

function recordDiscordRateHeaders(routeKey: string, response: Response): void {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const resetAfterSeconds = Number(response.headers.get("x-ratelimit-reset-after"));
  if (remaining === 0 && Number.isFinite(resetAfterSeconds) && resetAfterSeconds > 0) {
    setCooldown(
      routeKey,
      Math.min(DISCORD_MAX_RETRY_AFTER_MS, Math.ceil(resetAfterSeconds * 1_000)),
    );
  }
}

async function discordRequest(
  routeKey: string,
  input: string,
  init: RequestInit,
  budget: ExternalRequestBudget,
  fetchImpl: FetchLike = fetch,
): Promise<DiscordRequestResult> {
  const deferredSeconds = cooldownSeconds(routeKey);
  if (deferredSeconds > 0) {
    return {
      deferred: {
        ok: false,
        errorCode: "discord_rate_limit_cooldown",
        retryAfterSeconds: deferredSeconds,
      },
    };
  }
  try {
    const response = await fetchWithTimeout(
      input,
      init,
      {
        timeoutMs: DISCORD_FETCH_TIMEOUT_MS,
        budget,
        budgetErrorCode: "discord_request_budget_exhausted",
        timeoutErrorCode: "discord_api_timeout",
        networkErrorCode: "discord_api_network_error",
      },
      fetchImpl,
    );
    recordDiscordRateHeaders(routeKey, response);
    return { response };
  } catch (error) {
    return {
      deferred: {
        ok: false,
        errorCode: safeErrorSummary(error),
        retryAfterSeconds: 60,
      },
    };
  }
}

async function discordFailure(
  routeKey: string,
  response: Response,
  fallbackCode: string,
): Promise<DeliveryOutcome> {
  let retryAfterMs = parseRetryAfterMs(
    response.headers.get("retry-after"),
    DISCORD_MAX_RETRY_AFTER_MS,
  );
  let globalLimit =
    response.headers.get("x-ratelimit-global") === "true" ||
    response.headers.get("x-ratelimit-scope") === "global";
  if (response.status === 429 && retryAfterMs == null) {
    try {
      const body = (await response.json()) as {
        retry_after?: unknown;
        global?: unknown;
      };
      globalLimit ||= body.global === true;
      const seconds = Number(body.retry_after);
      if (Number.isFinite(seconds) && seconds >= 0) {
        retryAfterMs = Math.min(
          DISCORD_MAX_RETRY_AFTER_MS,
          Math.ceil(seconds * 1_000),
        );
      }
    } catch {
      await cancelResponseBody(response);
    }
  } else {
    await cancelResponseBody(response);
  }

  if (retryAfterMs != null && retryAfterMs > 0) {
    setCooldown(globalLimit ? DISCORD_GLOBAL_COOLDOWN_KEY : routeKey, retryAfterMs);
  }
  const permanent = response.status === 401 || response.status === 403 || response.status === 404;
  return {
    ok: false,
    errorCode: `${fallbackCode}_${response.status}`,
    retryAfterSeconds:
      retryAfterMs == null ? undefined : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
    permanent,
  };
}

async function recoverExpiredLeases(env: Env, now: number, limit: number): Promise<void> {
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
  ).bind(now, MAX_RETRIES, limit).run();

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
  ).bind(now, MAX_RETRIES, limit).run();
}

async function claimOutboxRow(env: Env, row: OutboxRow, token: string, now: number): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'processing', processing_started_at = ?1,
            lease_token = ?2, lease_expires_at = ?3
      WHERE id = ?4 AND status = 'pending'
        AND COALESCE(attempt_count, 0) < ?5
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)`,
  ).bind(now, token, now + PROCESSING_LEASE_SEC, row.id, MAX_RETRIES).run();
  return (result.meta?.changes ?? 0) === 1;
}

async function markSent(env: Env, rowId: string, token: string, now: number): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'sent', processing_started_at = NULL,
            lease_token = NULL, lease_expires_at = NULL,
            next_attempt_at = NULL, last_error = NULL, processed_at = ?1
      WHERE id = ?2 AND status = 'processing' AND lease_token = ?3`,
  ).bind(now, rowId, token).run();
  return (result.meta?.changes ?? 0) === 1;
}

async function markDeliveryFailure(
  env: Env,
  row: OutboxRow,
  token: string,
  outcome: DeliveryOutcome,
  now: number,
): Promise<void> {
  const attempts = Math.max(0, Number(row.attempt_count) || 0) + 1;
  const deadLetter = outcome.permanent === true || attempts >= MAX_RETRIES;
  const defaultDelay =
    RETRY_BACKOFF_SEC[Math.min(attempts - 1, RETRY_BACKOFF_SEC.length - 1)] ?? 900;
  const delaySeconds = Math.max(1, outcome.retryAfterSeconds ?? defaultDelay);
  await env.DB.prepare(
    `UPDATE notification_outbox
        SET attempt_count = ?1, status = ?2,
            processing_started_at = NULL, lease_token = NULL,
            lease_expires_at = NULL, next_attempt_at = ?3, last_error = ?4
      WHERE id = ?5 AND status = 'processing' AND lease_token = ?6`,
  ).bind(
    attempts,
    deadLetter ? "dead_letter" : "pending",
    deadLetter ? null : now + delaySeconds,
    (outcome.errorCode ?? "notification transport unavailable").slice(0, 240),
    row.id,
    token,
  ).run();
}

async function deliverWithOutcome(
  row: { type: string; payload_json: string; discord_id: string },
  env: Pick<Env, "KV" | "DISCORD_WEBHOOK_URL" | "DISCORD_BOT_TOKEN">,
  budget: ExternalRequestBudget,
  fetchImpl: FetchLike = fetch,
): Promise<DeliveryOutcome> {
  if (row.type === "discord_webhook") {
    if (!env.DISCORD_WEBHOOK_URL) {
      return { ok: false, errorCode: "discord_webhook_unconfigured", retryAfterSeconds: 900 };
    }
    const routeKey = `webhook:${env.DISCORD_WEBHOOK_URL}`;
    const request = await discordRequest(
      routeKey,
      env.DISCORD_WEBHOOK_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: row.payload_json,
      },
      budget,
      fetchImpl,
    );
    if (request.deferred) return request.deferred;
    if (request.response.ok) {
      await cancelResponseBody(request.response);
      return { ok: true };
    }
    return await discordFailure(routeKey, request.response, "discord_webhook_http");
  }

  if (!row.discord_id) {
    return { ok: false, errorCode: "discord_recipient_missing", permanent: true };
  }
  if (!env.DISCORD_BOT_TOKEN) {
    return { ok: false, errorCode: "discord_bot_token_unconfigured", retryAfterSeconds: 900 };
  }

  let channelId = await getCachedDmChannel(env, row.discord_id);
  const usedCachedChannel = Boolean(channelId);
  if (!channelId) {
    const openRoute = "discord:users:@me:channels";
    const open = await discordRequest(
      openRoute,
      "https://discord.com/api/v10/users/@me/channels",
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recipient_id: row.discord_id }),
      },
      budget,
      fetchImpl,
    );
    if (open.deferred) return open.deferred;
    if (!open.response.ok) {
      return await discordFailure(openRoute, open.response, "discord_dm_open_http");
    }
    try {
      const channel = (await open.response.json()) as { id?: unknown };
      channelId = typeof channel.id === "string" ? channel.id : null;
    } catch {
      return { ok: false, errorCode: "discord_dm_open_invalid_json", retryAfterSeconds: 300 };
    }
    if (!channelId) {
      return { ok: false, errorCode: "discord_dm_channel_missing", retryAfterSeconds: 300 };
    }
    await storeDmChannel(env, row.discord_id, channelId);
  }

  const messageRoute = `discord:channels:${channelId}:messages`;
  const message = await discordRequest(
    messageRoute,
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: row.payload_json,
    },
    budget,
    fetchImpl,
  );
  if (message.deferred) return message.deferred;
  if (message.response.ok) {
    await cancelResponseBody(message.response);
    return { ok: true };
  }
  if (usedCachedChannel && message.response.status === 404) {
    await cancelResponseBody(message.response);
    await evictDmChannel(env, row.discord_id);
    return {
      ok: false,
      errorCode: "discord_cached_dm_channel_not_found",
      retryAfterSeconds: 60,
    };
  }
  return await discordFailure(messageRoute, message.response, "discord_message_http");
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
  ).bind(MAX_RETRIES, now, limit).all<OutboxRow>();

  const budget = new ExternalRequestBudget(MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN);
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of result.results ?? []) {
    const token = crypto.randomUUID();
    if (!(await claimOutboxRow(env, row, token, now))) {
      skipped += 1;
      continue;
    }
    const outcome = await deliverWithOutcome(
      {
        type: row.type,
        payload_json: row.payload_json,
        discord_id: row.discord_id ?? "",
      },
      env,
      budget,
    );
    if (outcome.ok) {
      if (await markSent(env, row.id, token, now)) processed += 1;
      else skipped += 1;
      continue;
    }
    failed += 1;
    await markDeliveryFailure(env, row, token, outcome, now);
  }
  return { processed, failed, skipped };
}

/** 既存テスト・呼出し互換用。詳細なrate limit情報はdispatcher内部で扱う。 */
export async function deliver(
  row: { type: string; payload_json: string; discord_id: string },
  env: Pick<Env, "KV" | "DISCORD_WEBHOOK_URL" | "DISCORD_BOT_TOKEN">,
): Promise<boolean> {
  const outcome = await deliverWithOutcome(
    row,
    env,
    new ExternalRequestBudget(2),
  );
  return outcome.ok;
}
