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
const MARK_SENT_RETRY_ATTEMPTS = 3;
const MARK_SENT_RETRY_DELAY_MS = 50;
const RETRY_BACKOFF_SEC = [60, 300, 900] as const;
/** Discord配送成功後に sent 更新だけ失敗した行。再配送せず lease 回復で sent へ進める。 */
export const DELIVERY_SUCCEEDED_AWAITING_SENT_MARK =
  "delivery_succeeded_awaiting_sent_mark";
export const ORPHAN_RECIPIENT_ERROR = "recipient_user_not_found";
const DISCORD_FETCH_TIMEOUT_MS = 5_000;
const DISCORD_MAX_RETRY_AFTER_MS = 15 * 60 * 1_000;
const DISCORD_DM_CHANNEL_TTL_SEC = 30 * 24 * 60 * 60;
const DISCORD_DM_CHANNEL_CACHE_MAX = 1_000;
const DISCORD_GLOBAL_COOLDOWN_KEY = "discord:global";
const DISCORD_COOLDOWN_KV_PREFIX = "external-api:discord:cooldown:";
/** 6件 × 未cache時最大2 request。inline retryは行わない。 */
export const MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN = 12;
/** 2 writes/run。Queue wake 駆動 + 毎時0分 Recovery。KV Free の余裕を残す。 */
export const MAX_DISCORD_DM_KV_WRITES_PER_RUN = 2;
/** 429発生時だけ共有cooldownを保存する。通常runでは0 write。 */
export const MAX_DISCORD_COOLDOWN_KV_WRITES_PER_RUN = 2;
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

function abortReason(signal: AbortSignal, fallback = "notification queue aborted"): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(
    signal.reason === undefined ? fallback : String(signal.reason),
  );
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function rethrowAbort(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
  if (isAbortError(error)) throw error;
}

function boundedLimit(value: unknown): number {
  const requested = Number(value ?? MAX_NOTIFICATION_BATCH);
  if (!Number.isFinite(requested)) return MAX_NOTIFICATION_BATCH;
  return Math.min(MAX_NOTIFICATION_BATCH, Math.max(1, Math.floor(requested)));
}

async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!, "notification queue aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  throwIfAborted(signal);
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

async function getCachedDmChannel(
  env: Env,
  discordId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  throwIfAborted(signal);
  const now = Date.now();
  const local = dmChannelCache.get(discordId);
  if (local && local.expiresAt > now) {
    dmChannelCache.delete(discordId);
    dmChannelCache.set(discordId, local);
    return local.channelId;
  }
  if (local) dmChannelCache.delete(discordId);
  throwIfAborted(signal);
  if (!env.KV) return null;
  try {
    throwIfAborted(signal);
    const channelId = (await env.KV.get(dmCacheKey(discordId)))?.trim();
    throwIfAborted(signal);
    if (!channelId) return null;
    dmChannelCache.set(discordId, {
      channelId,
      expiresAt: now + DISCORD_DM_CHANNEL_TTL_SEC * 1_000,
    });
    pruneOldest(dmChannelCache, DISCORD_DM_CHANNEL_CACHE_MAX);
    return channelId;
  } catch (error) {
    rethrowAbort(error, signal);
    return null;
  }
}

async function storeDmChannel(
  env: Env,
  discordId: string,
  channelId: string,
  kvWriteBudget: ExternalRequestBudget,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  dmChannelCache.set(discordId, {
    channelId,
    expiresAt: Date.now() + DISCORD_DM_CHANNEL_TTL_SEC * 1_000,
  });
  pruneOldest(dmChannelCache, DISCORD_DM_CHANNEL_CACHE_MAX);
  throwIfAborted(signal);
  if (!env.KV || !kvWriteBudget.consume()) return;
  try {
    throwIfAborted(signal);
    await env.KV.put(dmCacheKey(discordId), channelId, {
      expirationTtl: DISCORD_DM_CHANNEL_TTL_SEC,
    });
    throwIfAborted(signal);
  } catch (error) {
    rethrowAbort(error, signal);
    // cache保存失敗でも今回の配送は継続する。
  }
}

async function evictDmChannel(
  env: Env,
  discordId: string,
  kvWriteBudget: ExternalRequestBudget,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  dmChannelCache.delete(discordId);
  throwIfAborted(signal);
  if (!env.KV || !kvWriteBudget.consume()) return;
  try {
    throwIfAborted(signal);
    await env.KV.delete(dmCacheKey(discordId));
    throwIfAborted(signal);
  } catch (error) {
    rethrowAbort(error, signal);
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

async function cooldownKvKey(routeKey: string): Promise<string> {
  if (routeKey === DISCORD_GLOBAL_COOLDOWN_KEY) {
    return `${DISCORD_COOLDOWN_KV_PREFIX}global`;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(routeKey),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${DISCORD_COOLDOWN_KV_PREFIX}route:${hash}`;
}

async function sharedCooldownUntil(
  env: Pick<Env, "KV">,
  key: string,
  now: number,
  readCache: Map<string, number>,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  const cached = readCache.get(key);
  if (cached !== undefined) return cached > now ? cached : 0;
  if (!env.KV) return 0;
  try {
    const raw = await env.KV.get(await cooldownKvKey(key));
    throwIfAborted(signal);
    const parsed = Number(raw);
    const until =
      Number.isFinite(parsed) && parsed > now
        ? Math.min(parsed, now + DISCORD_MAX_RETRY_AFTER_MS)
        : 0;
    readCache.set(key, until);
    return until;
  } catch (error) {
    rethrowAbort(error, signal);
    readCache.set(key, 0);
    return 0;
  }
}

async function cooldownSeconds(
  env: Pick<Env, "KV">,
  routeKey: string,
  readCache: Map<string, number>,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<number> {
  const [sharedGlobal, sharedRoute] = await Promise.all([
    sharedCooldownUntil(env, DISCORD_GLOBAL_COOLDOWN_KEY, now, readCache, signal),
    sharedCooldownUntil(env, routeKey, now, readCache, signal),
  ]);
  throwIfAborted(signal);
  const until = Math.max(
    activeCooldownUntil(DISCORD_GLOBAL_COOLDOWN_KEY, now),
    activeCooldownUntil(routeKey, now),
    sharedGlobal,
    sharedRoute,
  );
  return until > 0 ? Math.max(1, Math.ceil((until - now) / 1_000)) : 0;
}

async function setCooldown(
  env: Pick<Env, "KV">,
  routeKey: string,
  delayMs: number,
  kvWriteBudget: ExternalRequestBudget,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) return;
  const until = Date.now() + Math.min(DISCORD_MAX_RETRY_AFTER_MS, delayMs);
  discordCooldowns.set(routeKey, until);
  pruneOldest(discordCooldowns, 512);
  throwIfAborted(signal);
  if (!env.KV || !kvWriteBudget.consume()) return;
  try {
    await env.KV.put(await cooldownKvKey(routeKey), String(until), {
      expirationTtl: Math.max(60, Math.ceil(delayMs / 1_000) + 60),
    });
    throwIfAborted(signal);
  } catch (error) {
    rethrowAbort(error, signal);
    // D1 outbox leaseとnext_attempt_atが正本。KV共有失敗時も配送結果を上書きしない。
  }
}

async function recordDiscordRateHeaders(
  env: Pick<Env, "KV">,
  routeKey: string,
  response: Response,
  kvWriteBudget: ExternalRequestBudget,
  signal?: AbortSignal,
): Promise<void> {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const resetAfterSeconds = Number(response.headers.get("x-ratelimit-reset-after"));
  if (remaining === 0 && Number.isFinite(resetAfterSeconds) && resetAfterSeconds > 0) {
    await setCooldown(
      env,
      routeKey,
      Math.min(DISCORD_MAX_RETRY_AFTER_MS, Math.ceil(resetAfterSeconds * 1_000)),
      kvWriteBudget,
      signal,
    );
  }
}

async function discordRequest(
  env: Pick<Env, "KV">,
  routeKey: string,
  input: string,
  init: RequestInit,
  budget: ExternalRequestBudget,
  cooldownKvWriteBudget: ExternalRequestBudget,
  cooldownReadCache: Map<string, number>,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<DiscordRequestResult> {
  throwIfAborted(signal);
  const deferredSeconds = await cooldownSeconds(
    env,
    routeKey,
    cooldownReadCache,
    Date.now(),
    signal,
  );
  if (deferredSeconds > 0) {
    return {
      deferred: {
        ok: false,
        errorCode: "discord_rate_limit_cooldown",
        retryAfterSeconds: deferredSeconds,
      },
    };
  }
  throwIfAborted(signal);
  try {
    const response = await fetchWithTimeout(
      input,
      { ...init, signal },
      {
        timeoutMs: DISCORD_FETCH_TIMEOUT_MS,
        budget,
        budgetErrorCode: "discord_request_budget_exhausted",
        timeoutErrorCode: "discord_api_timeout",
        networkErrorCode: "discord_api_network_error",
      },
      fetchImpl,
    );
    if (signal?.aborted) {
      await cancelResponseBody(response);
      throw abortReason(signal);
    }
    await recordDiscordRateHeaders(
      env,
      routeKey,
      response,
      cooldownKvWriteBudget,
      signal,
    );
    return { response };
  } catch (error) {
    rethrowAbort(error, signal);
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
  env: Pick<Env, "KV">,
  routeKey: string,
  response: Response,
  fallbackCode: string,
  cooldownKvWriteBudget: ExternalRequestBudget,
  signal?: AbortSignal,
): Promise<DeliveryOutcome> {
  // Discord 429: runtime delivery safety (cooldown / next_attempt_at). Does not mutate operation_mode.
  throwIfAborted(signal);
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
      throwIfAborted(signal);
    } catch (error) {
      rethrowAbort(error, signal);
      await cancelResponseBody(response);
      throwIfAborted(signal);
    }
  } else {
    await cancelResponseBody(response);
    throwIfAborted(signal);
  }

  throwIfAborted(signal);
  if (retryAfterMs != null && retryAfterMs > 0) {
    await setCooldown(
      env,
      globalLimit ? DISCORD_GLOBAL_COOLDOWN_KEY : routeKey,
      retryAfterMs,
      cooldownKvWriteBudget,
      signal,
    );
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

async function recoverDeliveredAwaitingSentMark(
  env: Env,
  now: number,
  limit: number,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'sent', processing_started_at = NULL,
            lease_token = NULL, lease_expires_at = NULL,
            next_attempt_at = NULL, last_error = NULL, processed_at = ?1
      WHERE status = 'processing'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at <= ?1
        AND last_error = ?2
      LIMIT ?3`,
  ).bind(now, DELIVERY_SUCCEEDED_AWAITING_SENT_MARK, limit).run();
  throwIfAborted(signal);
  return Math.max(0, Number(result.meta?.changes ?? 0));
}

async function recoverExpiredLeases(
  env: Env,
  now: number,
  limit: number,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  const deliveredRecovery = await recoverDeliveredAwaitingSentMark(env, now, limit, signal);
  throwIfAborted(signal);
  const pendingResult = await env.DB.prepare(
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
  throwIfAborted(signal);

  throwIfAborted(signal);
  const deadLetterResult = await env.DB.prepare(
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
  throwIfAborted(signal);
  return (
    deliveredRecovery +
    Math.max(0, Number(pendingResult.meta?.changes ?? 0)) +
    Math.max(0, Number(deadLetterResult.meta?.changes ?? 0))
  );
}

async function claimOutboxRow(
  env: Env,
  row: OutboxRow,
  token: string,
  now: number,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'processing', processing_started_at = ?1,
            lease_token = ?2, lease_expires_at = ?3
      WHERE id = ?4 AND status = 'pending'
        AND COALESCE(attempt_count, 0) < ?5
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)`,
  ).bind(now, token, now + PROCESSING_LEASE_SEC, row.id, MAX_RETRIES).run();
  throwIfAborted(signal);
  return (result.meta?.changes ?? 0) === 1;
}

async function markSent(
  env: Env,
  rowId: string,
  token: string,
  now: number,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'sent', processing_started_at = NULL,
            lease_token = NULL, lease_expires_at = NULL,
            next_attempt_at = NULL, last_error = NULL, processed_at = ?1
      WHERE id = ?2 AND status = 'processing' AND lease_token = ?3`,
  ).bind(now, rowId, token).run();
  throwIfAborted(signal);
  return (result.meta?.changes ?? 0) === 1;
}

async function markSentWithRetries(
  env: Env,
  rowId: string,
  token: string,
  now: number,
  signal?: AbortSignal,
): Promise<boolean> {
  for (let attempt = 0; attempt < MARK_SENT_RETRY_ATTEMPTS; attempt += 1) {
    if (await markSent(env, rowId, token, now, signal)) return true;
    if (attempt < MARK_SENT_RETRY_ATTEMPTS - 1) {
      await sleepMs(MARK_SENT_RETRY_DELAY_MS, signal);
    }
  }
  return false;
}

async function markSentOrSuppressRedelivery(
  env: Env,
  rowId: string,
  token: string,
  now: number,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET last_error = ?1, lease_expires_at = ?2
      WHERE id = ?3 AND status = 'processing' AND lease_token = ?4`,
  ).bind(
    DELIVERY_SUCCEEDED_AWAITING_SENT_MARK,
    now + PROCESSING_LEASE_SEC,
    rowId,
    token,
  ).run();
  throwIfAborted(signal);
  return (result.meta?.changes ?? 0) === 1;
}

async function markDeliveryFailure(
  env: Env,
  row: OutboxRow,
  token: string,
  outcome: DeliveryOutcome,
  now: number,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  const attempts = Math.max(0, Number(row.attempt_count) || 0) + 1;
  const deadLetter = outcome.permanent === true || attempts >= MAX_RETRIES;
  const defaultDelay =
    RETRY_BACKOFF_SEC[Math.min(attempts - 1, RETRY_BACKOFF_SEC.length - 1)] ?? 900;
  const delaySeconds = Math.max(1, outcome.retryAfterSeconds ?? defaultDelay);
  const result = await env.DB.prepare(
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
  throwIfAborted(signal);
  const changes = Math.max(0, Number(result.meta?.changes ?? 0));
  if (deadLetter && changes > 0) {
    await enqueueDeadLetterOpsAlert(
      env,
      row,
      attempts,
      (outcome.errorCode ?? "notification transport unavailable").slice(0, 240),
      now,
      signal,
    );
  }
  return changes;
}

async function enqueueDeadLetterOpsAlert(
  env: Env,
  row: OutboxRow,
  attemptCount: number,
  lastError: string,
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!env.DISCORD_WEBHOOK_URL || row.type === "discord_webhook") return;
  const dedupeKey = `delivery_failed_alert:${row.id}`;
  const existing = await env.DB.prepare(
    `SELECT id FROM notification_outbox
      WHERE dedupe_key = ?1
        AND status IN ('pending', 'processing', 'sent')
      LIMIT 1`,
  )
    .bind(dedupeKey)
    .all<{ id: string }>();
  throwIfAborted(signal);
  if ((existing.results?.length ?? 0) > 0) return;

  const { buildDeliveryFailureOpsNotification } = await import(
    "../../src/lib/notifications/templates/errors.ts"
  );
  const payload = buildDeliveryFailureOpsNotification({
    outboxId: row.id,
    notificationType: row.type,
    recipientUserId: row.recipient_user_id,
    discordId: row.discord_id,
    attemptCount,
    lastError,
  });
  await env.DB.prepare(
    `INSERT INTO notification_outbox (
      id, recipient_user_id, type, payload_json, status, attempt_count,
      processing_started_at, lease_token, lease_expires_at, next_attempt_at,
      last_error, event_id, dedupe_key, created_at
    ) VALUES (
      ?1, ?2, 'discord_webhook', ?3, 'pending', 0,
      NULL, NULL, NULL, NULL, NULL, NULL, ?4, ?5
    )`,
  )
    .bind(
      crypto.randomUUID(),
      row.recipient_user_id,
      JSON.stringify(payload),
      dedupeKey,
      now,
    )
    .run();
  throwIfAborted(signal);
}

/** outbox payload から Discord API が受理するキーだけを残す。 */
function discordApiBodyJson(payloadJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  if (typeof source.content === "string") body.content = source.content;
  if (Array.isArray(source.embeds)) body.embeds = source.embeds;
  if (source.allowed_mentions && typeof source.allowed_mentions === "object") {
    body.allowed_mentions = source.allowed_mentions;
  }
  if (typeof source.tts === "boolean") body.tts = source.tts;
  if (typeof source.flags === "number") body.flags = source.flags;
  if (typeof source.username === "string") body.username = source.username;
  if (typeof source.avatar_url === "string") body.avatar_url = source.avatar_url;
  if (typeof body.content !== "string" && !Array.isArray(body.embeds)) return null;
  return JSON.stringify(body);
}

async function deliverWithOutcome(
  row: { type: string; payload_json: string; discord_id: string },
  env: Pick<Env, "KV" | "DISCORD_WEBHOOK_URL" | "DISCORD_BOT_TOKEN">,
  budget: ExternalRequestBudget,
  kvWriteBudget: ExternalRequestBudget,
  cooldownKvWriteBudget: ExternalRequestBudget,
  cooldownReadCache: Map<string, number>,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<DeliveryOutcome> {
  throwIfAborted(signal);
  const apiBody = discordApiBodyJson(row.payload_json);
  if (!apiBody) {
    return { ok: false, errorCode: "discord_payload_invalid", permanent: true };
  }
  if (row.type === "discord_webhook") {
    if (!env.DISCORD_WEBHOOK_URL) {
      return {
        ok: false,
        errorCode: "discord_channel_webhook_unconfigured",
        retryAfterSeconds: 900,
      };
    }
    const routeKey = `webhook:${env.DISCORD_WEBHOOK_URL}`;
    const request = await discordRequest(
      env,
      routeKey,
      env.DISCORD_WEBHOOK_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: apiBody,
      },
      budget,
      cooldownKvWriteBudget,
      cooldownReadCache,
      fetchImpl,
      signal,
    );
    throwIfAborted(signal);
    if (request.deferred) return request.deferred;
    if (request.response.ok) {
      await cancelResponseBody(request.response);
      throwIfAborted(signal);
      return { ok: true };
    }
    return await discordFailure(
      env,
      routeKey,
      request.response,
      "discord_webhook_http",
      cooldownKvWriteBudget,
      signal,
    );
  }

  throwIfAborted(signal);
  if (!row.discord_id) {
    return { ok: false, errorCode: "discord_recipient_missing", permanent: true };
  }
  if (!env.DISCORD_BOT_TOKEN) {
    return {
      ok: false,
      errorCode: "discord_dm_bot_token_unconfigured",
      retryAfterSeconds: 900,
    };
  }

  let channelId = await getCachedDmChannel(env, row.discord_id, signal);
  throwIfAborted(signal);
  const usedCachedChannel = Boolean(channelId);
  if (!channelId) {
    const openRoute = "discord:users:@me:channels";
    const open = await discordRequest(
      env,
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
      cooldownKvWriteBudget,
      cooldownReadCache,
      fetchImpl,
      signal,
    );
    throwIfAborted(signal);
    if (open.deferred) return open.deferred;
    if (!open.response.ok) {
      return await discordFailure(
        env,
        openRoute,
        open.response,
        "discord_dm_open_http",
        cooldownKvWriteBudget,
        signal,
      );
    }
    try {
      const channel = (await open.response.json()) as { id?: unknown };
      throwIfAborted(signal);
      channelId = typeof channel.id === "string" ? channel.id : null;
    } catch (error) {
      rethrowAbort(error, signal);
      return { ok: false, errorCode: "discord_dm_open_invalid_json", retryAfterSeconds: 300 };
    }
    if (!channelId) {
      return { ok: false, errorCode: "discord_dm_channel_missing", retryAfterSeconds: 300 };
    }
    await storeDmChannel(env, row.discord_id, channelId, kvWriteBudget, signal);
    throwIfAborted(signal);
  }

  throwIfAborted(signal);
  const messageRoute = `discord:channels:${channelId}:messages`;
  const message = await discordRequest(
    env,
    messageRoute,
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: apiBody,
    },
    budget,
    cooldownKvWriteBudget,
    cooldownReadCache,
    fetchImpl,
    signal,
  );
  throwIfAborted(signal);
  if (message.deferred) return message.deferred;
  if (message.response.ok) {
    await cancelResponseBody(message.response);
    throwIfAborted(signal);
    return { ok: true };
  }
  if (usedCachedChannel && message.response.status === 404) {
    await cancelResponseBody(message.response);
    throwIfAborted(signal);
    await evictDmChannel(env, row.discord_id, kvWriteBudget, signal);
    throwIfAborted(signal);
    return {
      ok: false,
      errorCode: "discord_cached_dm_channel_not_found",
      retryAfterSeconds: 60,
    };
  }
  return await discordFailure(
    env,
    messageRoute,
    message.response,
    "discord_message_http",
    cooldownKvWriteBudget,
    signal,
  );
}

export async function recoverNotificationOutboxExpiredLeases(
  env: Env,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<number> {
  const signal = opts?.signal;
  throwIfAborted(signal);
  const limit = boundedLimit(opts?.limit);
  const now = Math.floor(Date.now() / 1000);
  return recoverExpiredLeases(env, now, limit, signal);
}

export async function deadLetterOrphanPendingNotifications(
  env: Env,
  now: number,
  limit: number,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'dead_letter',
            processing_started_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            next_attempt_at = NULL,
            last_error = ?1,
            processed_at = ?2
      WHERE id IN (
        SELECT n.id
          FROM notification_outbox n
          LEFT JOIN "user" u ON u.id = n.recipient_user_id
         WHERE n.status = 'pending'
           AND u.id IS NULL
         LIMIT ?3
      )`,
  )
    .bind(ORPHAN_RECIPIENT_ERROR, now, limit)
    .run();
  throwIfAborted(signal);
  return Math.max(0, Number(result.meta?.changes ?? 0));
}

export async function hasDuePendingNotifications(
  env: Env,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `SELECT n.id
       FROM notification_outbox n
       INNER JOIN "user" u ON u.id = n.recipient_user_id
      WHERE n.status = 'pending'
        AND COALESCE(n.attempt_count, 0) < ?1
        AND (n.next_attempt_at IS NULL OR n.next_attempt_at <= ?2)
      LIMIT 1`,
  )
    .bind(MAX_RETRIES, now)
    .all<{ id: string }>();
  throwIfAborted(signal);
  return (result.results?.length ?? 0) > 0;
}

export async function processNotificationQueue(
  env: Env,
  opts?: { limit?: number; signal?: AbortSignal; skipLeaseRecovery?: boolean },
): Promise<{
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
  quota_stopped: boolean;
}> {
  const signal = opts?.signal;
  throwIfAborted(signal);
  const limit = boundedLimit(opts?.limit);
  const now = Math.floor(Date.now() / 1000);
  let d1Changes = 0;
  if (!opts?.skipLeaseRecovery) {
    d1Changes = await recoverExpiredLeases(env, now, limit, signal);
    throwIfAborted(signal);
  }
  d1Changes += await deadLetterOrphanPendingNotifications(env, now, limit, signal);
  throwIfAborted(signal);
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
  throwIfAborted(signal);

  const budget = new ExternalRequestBudget(MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN);
  const kvWriteBudget = new ExternalRequestBudget(MAX_DISCORD_DM_KV_WRITES_PER_RUN);
  const cooldownKvWriteBudget = new ExternalRequestBudget(
    MAX_DISCORD_COOLDOWN_KV_WRITES_PER_RUN,
  );
  // global/routeごとの共有cooldownは1 invocation内で一度だけ読む。
  const cooldownReadCache = new Map<string, number>();
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of result.results ?? []) {
    throwIfAborted(signal);
    const token = crypto.randomUUID();
    if (!(await claimOutboxRow(env, row, token, now, signal))) {
      skipped += 1;
      continue;
    }
    d1Changes += 1;
    throwIfAborted(signal);
    const outcome = await deliverWithOutcome(
      {
        type: row.type,
        payload_json: row.payload_json,
        discord_id: row.discord_id ?? "",
      },
      env,
      budget,
      kvWriteBudget,
      cooldownKvWriteBudget,
      cooldownReadCache,
      fetch,
      signal,
    );
    throwIfAborted(signal);
    if (outcome.ok) {
      if (await markSentWithRetries(env, row.id, token, now, signal)) {
        d1Changes += 1;
        processed += 1;
      } else if (await markSentOrSuppressRedelivery(env, row.id, token, now, signal)) {
        d1Changes += 1;
        processed += 1;
      } else {
        skipped += 1;
      }
      continue;
    }
    throwIfAborted(signal);
    failed += 1;
    d1Changes += await markDeliveryFailure(env, row, token, outcome, now, signal);
  }
  throwIfAborted(signal);
  return {
    processed,
    failed,
    skipped,
    external_api_calls: budget.used,
    d1_changes: d1Changes,
    retry_count: 0,
    quota_stopped: false,
  };
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
    new ExternalRequestBudget(1),
    new ExternalRequestBudget(1),
    new Map<string, number>(),
  );
  return outcome.ok;
}
