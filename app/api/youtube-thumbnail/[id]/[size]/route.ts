export const runtime = "edge";

import {
  YOUTUBE_THUMB_SIZES,
  type YoutubeThumbSize,
} from "@/lib/youtube/id";

export const dynamic = "force-dynamic";

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
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
  __flamenodeYoutubeThumbImages?: Map<string, ImageCacheEntry>;
  __flamenodeYoutubeThumbFailures?: Map<string, FailureCacheEntry>;
};

const imageCache =
  globalCache.__flamenodeYoutubeThumbImages ?? new Map<string, ImageCacheEntry>();
const failureCache =
  globalCache.__flamenodeYoutubeThumbFailures ??
  new Map<string, FailureCacheEntry>();

globalCache.__flamenodeYoutubeThumbImages = imageCache;
globalCache.__flamenodeYoutubeThumbFailures = failureCache;

function normalizeSize(raw: string | undefined): YoutubeThumbSize | null {
  const value = (raw ?? "").replace(/\.jpg$/i, "");
  return (YOUTUBE_THUMB_SIZES as readonly string[]).includes(value)
    ? (value as YoutubeThumbSize)
    : null;
}

function pruneCache<T>(cache: Map<string, T>): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const deleteCount = Math.ceil(MAX_CACHE_ENTRIES / 10);
  for (const key of cache.keys()) {
    cache.delete(key);
    if (cache.size <= MAX_CACHE_ENTRIES - deleteCount) break;
  }
}

function cacheKey(id: string, size: YoutubeThumbSize): string {
  return `${id}:${size}`;
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="サムネイルを取得できません"><rect width="640" height="360" fill="#15181d"/><path d="M278 228V132l92 48-92 48Z" fill="#c9ff00"/><text x="320" y="284" text-anchor="middle" fill="#f4f7ef" font-family="Arial, sans-serif" font-size="24" font-weight="700">サムネイルを取得できません</text></svg>`;
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
  { params }: { params: Promise<{ id?: string; size?: string }> },
): Promise<Response> {
  const { id: rawId, size: rawSize } = await params;
  const id = (rawId ?? "").trim();
  const size = normalizeSize(rawSize);
  if (!YOUTUBE_ID_RE.test(id) || !size) {
    return new Response("Not found", { status: 404 });
  }

  const key = cacheKey(id, size);
  const now = Date.now();
  const cached = imageCache.get(key);
  if (cached && cached.expiresAt > now) {
    return imageResponse(cached, "hit");
  }

  const recentFailure = failureCache.get(key);
  if (recentFailure && recentFailure.expiresAt > now) {
    if (cached && cached.staleUntil > now) {
      return imageResponse(cached, "stale");
    }
    return fallbackResponse(recentFailure.status);
  }

  try {
    const upstream = await fetchWithTimeout(
      `https://i.ytimg.com/vi/${id}/${size}.jpg`,
    );
    const contentType =
      upstream.headers.get("content-type")?.split(";")[0].trim() ||
      "image/jpeg";

    if (!upstream.ok || !contentType.startsWith("image/")) {
      failureCache.set(key, {
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
    imageCache.set(key, entry);
    failureCache.delete(key);
    pruneCache(imageCache);
    return imageResponse(entry, "miss");
  } catch {
    failureCache.set(key, {
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
