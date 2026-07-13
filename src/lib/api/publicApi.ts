const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;
const MAX_RATE_LIMIT_KEYS = 2048;

// Map 全走査は固定窓ごとに最大1回だけ行う。
let nextRateLimitCleanupAt = 0;

type RateLimitBucket = { windowStart: number; count: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();

function getClientKey(request: Request, endpoint: string): string {
  const connectingIp = request.headers.get("CF-Connecting-IP")?.trim();
  const forwarded = request.headers
    .get("X-Forwarded-For")
    ?.split(",", 1)[0]
    ?.trim();
  const ip = connectingIp || forwarded || "unknown";
  return `${endpoint}:${ip.slice(0, 128)}`;
}

function cleanupRateLimitBuckets(now: number): void {
  if (now < nextRateLimitCleanupAt) return;
  nextRateLimitCleanupAt = now + RATE_LIMIT_WINDOW_SECONDS;
  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_SECONDS) {
      rateLimitBuckets.delete(key);
    }
  }
}

/** Isolate 単位の best-effort 固定窓制限。D1/KV write は行わず、分散 isolate 間では共有されない。 */
export function checkPublicApiRateLimit(
  request: Request,
  endpoint: string,
  now = Math.floor(Date.now() / 1000),
): Response | null {
  cleanupRateLimitBuckets(now);
  const key = getClientKey(request, endpoint);
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_SECONDS) {
    if (!bucket && rateLimitBuckets.size >= MAX_RATE_LIMIT_KEYS) {
      return rateLimitedResponse(RATE_LIMIT_WINDOW_SECONDS);
    }
    bucket = { windowStart: now, count: 0 };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= RATE_LIMIT_MAX_REQUESTS) return null;
  return rateLimitedResponse(
    Math.max(1, RATE_LIMIT_WINDOW_SECONDS - (now - bucket.windowStart)),
  );
}

function rateLimitedResponse(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "Cache-Control": "no-store",
    },
  });
}

/**
 * 公開一覧APIの正の整数queryを既存仕様どおり正規化する。
 * 0・非数値はfallback、負数は1、上限超過はmaxへ丸める。
 */
export function parseBoundedPositiveInt(
  value: string | null | undefined,
  fallback: number,
  max = Number.POSITIVE_INFINITY,
): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10) || fallback;
  return Math.min(max, Math.max(1, parsed));
}

async function bodyEtag(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `"${hex}"`;
}

function etagMatches(request: Request, etag: string): boolean {
  const value = request.headers.get("If-None-Match");
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized.replace(/^W\//, "") === etag;
  });
}

export async function publicJsonResponse(
  request: Request,
  payload: unknown,
  cacheControl: string,
  status = 200,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const etag = await bodyEtag(body);
  const headers = { "Cache-Control": cacheControl, ETag: etag };
  if (status === 200 && etagMatches(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** DB/R2 binding 障害を空配列の正常応答としてキャッシュしない。 */
export function publicServiceUnavailableResponse(
  code = "service_temporarily_unavailable",
  retryAfterSeconds = 30,
): Response {
  return new Response(JSON.stringify({ error: code }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": String(Math.max(1, Math.floor(retryAfterSeconds))),
    },
  });
}

export function clearPublicApiRateLimitForTests(): void {
  rateLimitBuckets.clear();
  nextRateLimitCleanupAt = 0;
}
