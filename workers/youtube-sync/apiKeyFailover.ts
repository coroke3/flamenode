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

export const YOUTUBE_API_MAX_KEYS = 2;
export const YOUTUBE_API_KEY_DISABLE_SEC = 6 * 60 * 60;
export const YOUTUBE_API_KEY_STATUS_KV = "youtube-api:key-status:v1";

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

function normalizeReason(reason: string | null | undefined): string {
  return (reason ?? "").trim().toLowerCase();
}

export function classifyYoutubeApiError(
  status: number,
  reason: string | null | undefined,
): YoutubeApiErrorKind {
  const normalized = normalizeReason(reason);
  if (QUOTA_REASONS.has(normalized)) return "quota";
  if (CREDENTIAL_REASONS.has(normalized)) return "credential";
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return "transient";
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
      active_key:
        parsed.active_key === "primary" || parsed.active_key === "secondary"
          ? parsed.active_key
          : null,
      disabled_until: {
        primary: finiteNumber(parsed.disabled_until?.primary) ?? undefined,
        secondary: finiteNumber(parsed.disabled_until?.secondary) ?? undefined,
      },
      last_failover_at: finiteNumber(parsed.last_failover_at),
      last_failover_from:
        parsed.last_failover_from === "primary" ||
        parsed.last_failover_from === "secondary"
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
    return parseStatus(
      await env.KV.get(YOUTUBE_API_KEY_STATUS_KV),
      candidates,
      now,
    );
  } catch {
    return blankStatus(candidates, now);
  }
}

async function saveStatus(
  env: YoutubeApiKeyEnv,
  status: YoutubeApiKeyStatus,
): Promise<void> {
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

export async function runWithYoutubeApiKeyFailover<T>(
  env: YoutubeApiKeyEnv,
  candidates: readonly YoutubeApiKeyCandidate[],
  now: number,
  operation: (candidate: YoutubeApiKeyCandidate) => Promise<T>,
): Promise<T> {
  const status = await loadStatus(env, candidates, now);
  const ordered = orderYoutubeApiKeys(candidates, status.disabled_until, now);
  let lastError: unknown;
  let failedOver = false;

  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    try {
      const result = await operation(candidate);
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
      // quota系を別キーへ逃がさない。credential障害時だけ次候補を使う。
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
