import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { cancelR2BodyBestEffort } from "@/lib/r2Body";
import {
  normalizeTopStatsSection,
  TOP_STATS_OBJECT_KEY,
} from "@/lib/publicData/staticTopSectionsCore";

const MAX_STATS_BYTES = 64 * 1024;
const HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
  "X-Content-Type-Options": "nosniff",
} as const;
const UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store",
  "Retry-After": "30",
  "X-Content-Type-Options": "nosniff",
} as const;

function unavailable(): Response {
  return NextResponse.json(
    { stats: null },
    { status: 503, headers: UNAVAILABLE_HEADERS },
  );
}

export async function GET(req: Request): Promise<Response> {
  const cache =
    typeof caches !== "undefined" && "default" in caches
      ? (caches as unknown as { default?: Cache }).default ?? null
      : null;
  const cacheKey = cache ? new Request(req.url, { method: "GET" }) : null;

  if (cache && cacheKey) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Cache match failure is non-fatal
    }
  }

  try {
    const bucket = getEnv().BUCKET;
    const object = await bucket.get(TOP_STATS_OBJECT_KEY);
    if (!object) return unavailable();
    if (
      !Number.isSafeInteger(object.size) ||
      object.size < 0 ||
      object.size > MAX_STATS_BYTES
    ) {
      await cancelR2BodyBestEffort(object);
      return unavailable();
    }

    const stats = normalizeTopStatsSection(await object.json<unknown>());
    if (!stats) return unavailable();

    const response = NextResponse.json(
      {
        stats: {
          publicVideos: stats.stats.public_videos,
          creators: stats.stats.creators,
          events: stats.stats.public_events,
        },
      },
      { headers: HEADERS },
    );

    if (cache && cacheKey) {
      void cache.put(cacheKey, response.clone()).catch(() => {
        // Cache put failure is non-fatal
      });
    }

    return response;
  } catch (error) {
    console.warn("[about-stats] compact R2 stats read failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return unavailable();
  }
}