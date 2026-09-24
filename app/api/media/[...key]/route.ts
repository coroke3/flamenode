import {
  CloudflareBindingsUnavailableError,
  getEnv,
} from "@/lib/cloudflare";
import { servePublicMedia } from "@/lib/media/publicMedia";

const UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store",
  "Retry-After": "30",
} as const;

function getEdgeCache(): Cache | null {
  try {
    if (typeof caches !== "undefined" && "default" in caches) {
      return (caches as unknown as { default: Cache }).default ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key?: string[] }> },
): Promise<Response> {
  const { key } = await params;
  const rawKey = key?.join("/") ?? "";

  const cache = getEdgeCache();
  if (cache && request) {
    try {
      const url = new URL(request.url);
      const cacheKey = new Request(`${url.origin}/api/media/${rawKey}`, { method: "GET" });
      const cached = await cache.match(cacheKey);
      if (cached) {
        const ifNoneMatch = request.headers.get("If-None-Match");
        const cachedEtag = cached.headers.get("etag");
        if (
          ifNoneMatch &&
          cachedEtag &&
          ifNoneMatch.split(",").some((candidate) => {
            const normalized = candidate.trim();
            return (
              normalized === "*" ||
              normalized.replace(/^W\//, "") === cachedEtag.replace(/^W\//, "")
            );
          })
        ) {
          return new Response(null, {
            status: 304,
            headers: new Headers(cached.headers),
          });
        }
        return cached;
      }
    } catch {
      // cache miss / lookup error, continue to origin
    }
  }

  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    if (!(error instanceof CloudflareBindingsUnavailableError)) throw error;
    console.error("[public-media] runtime bindings unavailable", {
      missing: error.missing,
    });
    return new Response("Storage temporarily unavailable", {
      status: 503,
      headers: UNAVAILABLE_HEADERS,
    });
  }
  if (!env.BUCKET || !env.DB) {
    return new Response("Storage temporarily unavailable", {
      status: 503,
      headers: UNAVAILABLE_HEADERS,
    });
  }
  return servePublicMedia(env, rawKey, request);
}