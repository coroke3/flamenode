export type YoutubeApiKeyLabel = "primary" | "secondary";
export type YoutubeApiErrorKind = "quota" | "credential" | "transient" | "permanent";

export interface YoutubeApiKeyEnv {
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_API_KEY_SECONDARY?: string;
}

export type YoutubeApiKeyCandidate = {
  label: YoutubeApiKeyLabel;
  key: string;
};

export type YoutubeApiKeyStatus = {
  version: 1;
  configured: YoutubeApiKeyLabel[];
  active_key: YoutubeApiKeyLabel | null;
  disabled_until: Partial<Record<YoutubeApiKeyLabel, number>>;
  last_failover_at: number | null;
  last_failover_from: YoutubeApiKeyLabel | null;
  last_failure_kind: YoutubeApiErrorKind | null;
  last_failure_reason: string | null;
  updated_at: number;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const YOUTUBE_API_MAX_KEYS = 2;
export const YOUTUBE_API_MAX_ATTEMPTS = 2;
export const YOUTUBE_API_FETCH_TIMEOUT_MS = 8_000;
export const YOUTUBE_API_MAX_RETRY_DELAY_MS = 15_000;
export const YOUTUBE_API_KEY_DISABLE_SEC = 6 * 60 * 60;
export const YOUTUBE_API_KEY_STATUS_KV = "youtube-api:key-status:v1";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const QUOTA_REASONS = new Set([
  "quotaexceeded",
  "dailylimitexceeded",
  "dailylimitexceededunreg",
  "ratelimitexceeded",
  "userratelimitexceeded",
  "resource_exhausted",
]);
const CREDENTIAL_REASONS = new Set([
  "keyinvalid",
  "apikeyinvalid",
  "api_key_invalid",
  "keyexpired",
  "accessnotconfigured",
  "servicedisabled",
  "service_disabled",
  "iprefererblocked",
]);

export class YoutubeApiRequestError extends Error {
  constructor(
    readonly kind: YoutubeApiErrorKind,
    readonly reason: string,
    readonly status: number,
  ) {
    super(`${kind}:youtube_api_${reason}`);
    this.name = "YoutubeApiRequestError";
  }
}

function normalizedReason(reason: string | null | undefined): string {
  return (reason ?? "").trim().toLowerCase();
}

export function isRetryableYoutubeStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

export function classifyYoutubeApiError(
  status: number,
  reason: string | null | undefined,
): YoutubeApiErrorKind {
  const normalized = normalizedReason(reason);
  if (QUOTA_REASONS.has(normalized)) return "quota";
  if (CREDENTIAL_REASONS.has(normalized)) return "credential";
  if (isRetryableYoutubeStatus(status)) return "transient";
  return "permanent";
}

/** quotaの合算・迂回には使わず、credential固有の障害だけを補完する。 */
export function shouldFailoverYoutubeApiKey(
  status: number,
  reason: string | null | undefined,
): boolean {
  return classifyYoutubeApiError(status, reason) === "credential";
}

export function resolveYoutubeApiKeys(
  env: Pick<YoutubeApiKeyEnv, "YOUTUBE_API_KEY" | "YOUTUBE_API_KEY_SECONDARY">,
): YoutubeApiKeyCandidate[] {
  const primary = env.YOUTUBE_API_KEY?.trim();
  const secondary = env.YOUTUBE_API_KEY_SECONDARY?.trim();
  const result: YoutubeApiKeyCandidate[] = [];
  if (primary) result.push({ label: "primary", key: primary });
  if (secondary && !result.some((item) => item.key === secondary)) {
    result.push({ label: "secondary", key: secondary });
  }
  return result.slice(0, YOUTUBE_API_MAX_KEYS);
}

export function orderYoutubeApiKeys(
  candidates: readonly YoutubeApiKeyCandidate[],
  disabledUntil: Partial<Record<YoutubeApiKeyLabel, number>>,
  now: number,
): YoutubeApiKeyCandidate[] {
  const enabled = candidates.filter(
    (candidate) => Number(disabledUntil[candidate.label] ?? 0) <= now,
  );
  return enabled.length > 0 ? enabled : [...candidates];
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, YOUTUBE_API_MAX_RETRY_DELAY_MS);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - now), YOUTUBE_API_MAX_RETRY_DELAY_MS);
}

function blankStatus(
  candidates: readonly YoutubeApiKeyCandidate[],
  now: number,
): YoutubeApiKeyStatus {
  return {
    version: 1,
    configured: candidates.map((item) => item.label),
    active_key: null,
    disabled_until: {},
    last_failover_at: null,
    last_failover_from: null,
    last_failure_kind: null,
    last_failure_reason: null,
    updated_at: now,
  };
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStatus(
  raw: string | null,
  candidates: readonly YoutubeApiKeyCandidate[],
  now: number,
): YoutubeApiKeyStatus {
  const fallback = blankStatus(candidates, now);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<YoutubeApiKeyStatus>;
    return {
      ...fallback,
      active_key: parsed.active_key === "primary" || parsed.active_key === "secondary"
        ? parsed.active_key
        : null,
      disabled_until: {
        primary: finiteNumber(parsed.disabled_until?.primary) ?? undefined,
        secondary: finiteNumber(parsed.disabled_until?.secondary) ?? undefined,
      },
      last_failover_at: finiteNumber(parsed.last_failover_at),
      last_failover_from:
        parsed.last_failover_from === "primary" || parsed.last_failover_from === "secondary"
          ? parsed.last_failover_from
          : null,
      last_failure_kind:
        parsed.last_failure_kind === "quota" ||
        parsed.last_failure_kind === "credential" ||
        parsed.last_failure_kind === "transient" ||
        parsed.last_failure_kind === "permanent"
          ? parsed.last_failure_kind
          : null,
      last_failure_reason:
        typeof parsed.last_failure_reason === "string"
          ? parsed.last_failure_reason.slice(0, 100)
          : null,
      updated_at: finiteNumber(parsed.updated_at) ?? now,
    };
  } catch {
    return fallback;
  }
}

async function loadStatus(
  env: YoutubeApiKeyEnv,
  candidates: readonly YoutubeApiKeyCandidate[],
  now: number,
): Promise<YoutubeApiKeyStatus> {
  try {
    return parseStatus(await env.KV.get(YOUTUBE_API_KEY_STATUS_KV), candidates, now);
  } catch {
    return blankStatus(candidates, now);
  }
}

async function saveStatus(env: YoutubeApiKeyEnv, status: YoutubeApiKeyStatus): Promise<void> {
  try {
    await env.KV.put(YOUTUBE_API_KEY_STATUS_KV, JSON.stringify(status), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
  } catch {
    // 監視用KVの失敗で同期本体を止めない。
  }
}

export async function recordConfiguredYoutubeApiKeys(
  env: YoutubeApiKeyEnv,
  candidates: readonly YoutubeApiKeyCandidate[],
  now: number,
): Promise<void> {
  const status = await loadStatus(env, candidates, now);
  status.configured = candidates.map((item) => item.label);
  status.updated_at = now;
  await saveStatus(env, status);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type YoutubeErrorPayload = {
  error?: {
    status?: unknown;
    errors?: Array<{ reason?: unknown }>;
  };
};

async function readErrorReason(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as YoutubeErrorPayload;
    const detail = payload.error?.errors?.find((item) => typeof item.reason === "string");
    if (typeof detail?.reason === "string" && detail.reason.trim()) {
      return detail.reason.trim();
    }
    return typeof payload.error?.status === "string" && payload.error.status.trim()
      ? payload.error.status.trim()
      : null;
  } catch {
    return null;
  }
}

async function requestJson<T>(url: URL, fetchImpl: FetchLike): Promise<T> {
  let lastError: YoutubeApiRequestError | null = null;
  for (let attempt = 0; attempt < YOUTUBE_API_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), YOUTUBE_API_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      lastError = new YoutubeApiRequestError(
        "transient",
        error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error",
        0,
      );
      if (attempt + 1 >= YOUTUBE_API_MAX_ATTEMPTS) throw lastError;
      await wait(Math.min(1_000 * 2 ** attempt, YOUTUBE_API_MAX_RETRY_DELAY_MS));
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      try {
        return (await response.json()) as T;
      } catch {
        throw new YoutubeApiRequestError("permanent", "invalid_json", response.status);
      }
    }

    const reason = await readErrorReason(response);
    const kind = classifyYoutubeApiError(response.status, reason);
    lastError = new YoutubeApiRequestError(
      kind,
      normalizedReason(reason) || `http_${response.status}`,
      response.status,
    );
    // quota系を別キーへ逃がさない。429だけは同一キーでRetry-Afterに従う。
    const retrySameKey = kind === "transient" || (kind === "quota" && response.status === 429);
    if (!retrySameKey || attempt + 1 >= YOUTUBE_API_MAX_ATTEMPTS) throw lastError;
    const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
    await wait(retryAfter ?? Math.min(1_000 * 2 ** attempt, YOUTUBE_API_MAX_RETRY_DELAY_MS));
  }
  throw lastError ?? new YoutubeApiRequestError("permanent", "unknown", 0);
}

export async function fetchYoutubeJsonWithFailover<T>(
  env: YoutubeApiKeyEnv,
  baseUrl: URL,
  candidates: readonly YoutubeApiKeyCandidate[],
  fetchImpl: FetchLike,
  now: number,
): Promise<T> {
  const status = await loadStatus(env, candidates, now);
  const ordered = orderYoutubeApiKeys(candidates, status.disabled_until, now);
  let lastError: unknown;
  let failedOver = false;

  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    const url = new URL(baseUrl);
    url.searchParams.set("key", candidate.key);
    try {
      const result = await requestJson<T>(url, fetchImpl);
      delete status.disabled_until[candidate.label];
      status.configured = candidates.map((item) => item.label);
      status.active_key = candidate.label;
      if (!failedOver) {
        status.last_failure_kind = null;
        status.last_failure_reason = null;
      }
      status.updated_at = now;
      await saveStatus(env, status);
      return result;
    } catch (error) {
      lastError = error;
      const requestError = error instanceof YoutubeApiRequestError ? error : null;
      status.configured = candidates.map((item) => item.label);
      status.last_failure_kind = requestError?.kind ?? "permanent";
      status.last_failure_reason = requestError?.reason ?? "unknown";
      status.updated_at = now;

      const credentialFailure = requestError?.kind === "credential";
      const hasFallback = index + 1 < ordered.length;
      if (credentialFailure) {
        status.disabled_until[candidate.label] = now + YOUTUBE_API_KEY_DISABLE_SEC;
      }
      if (credentialFailure && hasFallback) {
        failedOver = true;
        status.last_failover_at = now;
        status.last_failover_from = candidate.label;
        await saveStatus(env, status);
        continue;
      }
      await saveStatus(env, status);
      throw error;
    }
  }

  throw lastError ?? new YoutubeApiRequestError("permanent", "api_key_missing", 0);
}
