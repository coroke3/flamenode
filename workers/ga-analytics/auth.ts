/**
 * GA4 Data API 用サービスアカウント JWT → OAuth access token。
 * 秘密情報はログへ出さない。
 */
import {
  cancelResponseBody,
  ExternalRequestBudget,
  fetchWithTimeout,
  type FetchLike,
} from "../shared/externalApi.ts";

export const GA4_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";
export const GA4_ACCESS_TOKEN_KV_KEY = "ga4:access-token:v1";
/** expires_in より短く、最大 ~50 分。 */
export const GA4_TOKEN_CACHE_MAX_TTL_SEC = 50 * 60;
export const GA4_TOKEN_SAFETY_SEC = 60;
export const GA4_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GA4_JWT_AUDIENCE = "https://oauth2.googleapis.com/token";
export const GA4_AUTH_FETCH_TIMEOUT_MS = 8_000;

export interface Ga4AuthEnv {
  KV: KVNamespace;
  GA4_SERVICE_ACCOUNT_EMAIL?: string;
  GA4_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

type CachedAccessToken = {
  access_token: string;
  expires_at: number;
};

function base64UrlEncode(data: string | ArrayBuffer): string {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizePrivateKeyPem(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = normalizePrivateKeyPem(pem);
  const pemContents = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(pemContents), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function createServiceAccountJwt(
  email: string,
  privateKeyPem: string,
  scope: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: email,
      scope,
      aud: GA4_JWT_AUDIENCE,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function parseCachedToken(raw: string | null): CachedAccessToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedAccessToken;
    if (
      typeof parsed.access_token !== "string" ||
      !parsed.access_token ||
      !Number.isFinite(parsed.expires_at)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function exchangeJwtForAccessToken(
  jwt: string,
  budget: ExternalRequestBudget,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<{ access_token: string; expires_in: number }> {
  signal?.throwIfAborted();
  const response = await fetchWithTimeout(
    GA4_OAUTH_TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal,
    },
    {
      timeoutMs: GA4_AUTH_FETCH_TIMEOUT_MS,
      budget,
      budgetErrorCode: "ga4_oauth_request_budget_exhausted",
      timeoutErrorCode: "ga4_oauth_timeout",
      networkErrorCode: "ga4_oauth_network_error",
    },
    fetchImpl,
  );
  signal?.throwIfAborted();
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`ga4_oauth_http_${response.status}`);
  }
  let body: { access_token?: unknown; expires_in?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    signal?.throwIfAborted();
    await cancelResponseBody(response);
    throw new Error("ga4_oauth_invalid_json");
  }
  signal?.throwIfAborted();
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("ga4_oauth_access_token_missing");
  }
  const expiresIn = Number(body.expires_in);
  return {
    access_token: body.access_token,
    expires_in:
      Number.isFinite(expiresIn) && expiresIn > 0 ? Math.floor(expiresIn) : 3600,
  };
}

export async function getGa4AccessToken(
  env: Ga4AuthEnv,
  budget: ExternalRequestBudget,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const email = env.GA4_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (!email || !privateKey) {
    throw new Error("ga4_service_account_config_missing");
  }

  const now = Math.floor(Date.now() / 1000);
  // KV is only a token cache.  A transient read failure must not prevent a
  // fresh OAuth exchange; cancellation remains fail-fast for the cron lease.
  let cachedRaw: string | null = null;
  try {
    cachedRaw = await env.KV.get(GA4_ACCESS_TOKEN_KV_KEY);
  } catch {
    signal?.throwIfAborted();
  }
  signal?.throwIfAborted();
  const cached = parseCachedToken(cachedRaw);
  if (cached && cached.expires_at - now > GA4_TOKEN_SAFETY_SEC) {
    return cached.access_token;
  }

  const jwt = await createServiceAccountJwt(
    email,
    privateKey,
    GA4_ANALYTICS_SCOPE,
  );
  signal?.throwIfAborted();
  const token = await exchangeJwtForAccessToken(jwt, budget, fetchImpl, signal);
  signal?.throwIfAborted();
  const expiresAt = now + token.expires_in;
  const ttl = Math.min(
    GA4_TOKEN_CACHE_MAX_TTL_SEC,
    Math.max(1, token.expires_in - GA4_TOKEN_SAFETY_SEC),
  );
  try {
    await env.KV.put(
      GA4_ACCESS_TOKEN_KV_KEY,
      JSON.stringify({
        access_token: token.access_token,
        expires_at: expiresAt,
      }),
      { expirationTtl: ttl },
    );
  } catch {
    signal?.throwIfAborted();
    // KV 障害で token 取得自体は成功しているため継続する。
  }
  signal?.throwIfAborted();
  return token.access_token;
}
