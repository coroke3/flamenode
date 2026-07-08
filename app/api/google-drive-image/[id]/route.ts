export const runtime = "edge";

export const dynamic = "force-dynamic";

const GOOGLE_DRIVE_ID_RE = /^[A-Za-z0-9_-]{6,}$/;
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const STALE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_CACHE_ENTRIES = 600;

type ImageCacheEntry = {
  bytes: Uint8Array;
  contentType: string;
  etag?: string;
  expiresAt: number;
  staleUntil: number;
};

type FailureCacheEntry = {
  status: number;
  expiresAt: number;
};

const globalCache = globalThis as typeof globalThis & {
  __flamenodeGoogleDriveImages?: Map<string, ImageCacheEntry>;
  __flamenodeGoogleDriveFailures?: Map<string, FailureCacheEntry>;
};

const imageCache =
  globalCache.__flamenodeGoogleDriveImages ?? new Map<string, ImageCacheEntry>();
const failureCache =
  globalCache.__flamenodeGoogleDriveFailures ??
  new Map<string, FailureCacheEntry>();

globalCache.__flamenodeGoogleDriveImages = imageCache;
globalCache.__flamenodeGoogleDriveFailures = failureCache;

function pruneCache<T>(cache: Map<string, T>): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const deleteCount = Math.ceil(MAX_CACHE_ENTRIES / 10);
  for (const key of cache.keys()) {
    cache.delete(key);
    if (cache.size <= MAX_CACHE_ENTRIES - deleteCount) break;
  }
}

function imageResponse(
  entry: ImageCacheEntry,
  cacheState: "hit" | "miss" | "stale",
): Response {
  const headers = new Headers({
    "cache-control":
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
    "content-type": entry.contentType,
    "x-fn-media-cache": cacheState,
  });
  if (entry.etag) headers.set("etag", entry.etag);
  return new Response(entry.bytes.slice(), { headers });
}

function fallbackResponse(status: number | null, cacheState = "fallback"): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="Image unavailable"><rect width="160" height="160" fill="#15181d"/><circle cx="80" cy="64" r="28" fill="#c9ff00"/><path d="M36 132c7-26 24-42 44-42s37 16 44 42H36Z" fill="#f4f7ef"/></svg>`;
  const headers = new Headers({
    "cache-control": "public, max-age=300, s-maxage=600",
    "content-type": "image/svg+xml; charset=utf-8",
    "x-fn-media-cache": cacheState,
  });
  if (status != null) headers.set("x-fn-upstream-status", String(status));
  return new Response(svg, { headers });
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id?: string }> },
): Promise<Response> {
  const { id: rawId } = await params;
  const id = (rawId ?? "").trim();
  if (!GOOGLE_DRIVE_ID_RE.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  const now = Date.now();
  const cached = imageCache.get(id);
  if (cached && cached.expiresAt > now) {
    return imageResponse(cached, "hit");
  }

  const recentFailure = failureCache.get(id);
  if (recentFailure && recentFailure.expiresAt > now) {
    if (cached && cached.staleUntil > now) {
      return imageResponse(cached, "stale");
    }
    return fallbackResponse(recentFailure.status);
  }

  try {
    const upstream = await fetchWithTimeout(
      `https://lh3.googleusercontent.com/d/${id}`,
    );
    const contentType =
      upstream.headers.get("content-type")?.split(";")[0].trim() ||
      "image/jpeg";

    if (!upstream.ok || !contentType.startsWith("image/")) {
      failureCache.set(id, {
        status: upstream.status,
        expiresAt: now + FAILURE_TTL_MS,
      });
      pruneCache(failureCache);
      if (cached && cached.staleUntil > now) {
        return imageResponse(cached, "stale");
      }
      return fallbackResponse(upstream.status);
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const entry: ImageCacheEntry = {
      bytes,
      contentType,
      etag: upstream.headers.get("etag") ?? undefined,
      expiresAt: now + SUCCESS_TTL_MS,
      staleUntil: now + STALE_TTL_MS,
    };
    imageCache.set(id, entry);
    failureCache.delete(id);
    pruneCache(imageCache);
    return imageResponse(entry, "miss");
  } catch {
    failureCache.set(id, {
      status: 0,
      expiresAt: now + FAILURE_TTL_MS,
    });
    pruneCache(failureCache);
    if (cached && cached.staleUntil > now) {
      return imageResponse(cached, "stale");
    }
    return fallbackResponse(null);
  }
}
