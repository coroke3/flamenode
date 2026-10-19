import { Hono } from "hono";
import type { AppEnv } from "../env.ts";

const MAX_STATS_BYTES = 64 * 1024;
const TOP_STATS_OBJECT_KEY = "top/sections/stats.v1.json";

const HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
  "X-Content-Type-Options": "nosniff",
} as const;
const UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store",
  "Retry-After": "30",
  "X-Content-Type-Options": "nosniff",
} as const;

function unavailable(c: { json: (data: unknown, status: any, headers: Record<string, string>) => Response }): Response {
  return c.json({ stats: null }, 503, UNAVAILABLE_HEADERS as unknown as Record<string, string>);
}

function cancelR2BodyBestEffort(object: { body?: ReadableStream | null } | null | undefined): void {
  try {
    object?.body?.cancel()?.catch(() => undefined);
  } catch {
    // Ignore best-effort cancellation error
  }
}

function parseTopStatsJson(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj.schema_version !== 1) return null;
  if (!obj.stats || typeof obj.stats !== "object") return null;
  const s = obj.stats as Record<string, unknown>;
  const publicVideos = typeof s.public_videos === "number" ? s.public_videos : 0;
  const creators = typeof s.creators === "number" ? s.creators : 0;
  const events = typeof s.public_events === "number" ? s.public_events : 0;
  return { publicVideos, creators, events };
}

export const publicAboutStatsRoutes = new Hono<AppEnv>();

// RH-026: GET /api/public/about-stats
publicAboutStatsRoutes.get("/", async (c) => {
  const cache =
    typeof caches !== "undefined" && "default" in caches
      ? (caches as unknown as { default?: Cache }).default ?? null
      : null;
  const cacheKey = cache
    ? new Request(`${new URL(c.req.url).origin}/api/public/about-stats`, {
        method: "GET",
      })
    : null;

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
    const bucket = c.env?.BUCKET;
    if (!bucket) return unavailable(c);

    const object = await bucket.get(TOP_STATS_OBJECT_KEY);
    if (!object) return unavailable(c);
    if (
      !Number.isSafeInteger(object.size) ||
      object.size < 0 ||
      object.size > MAX_STATS_BYTES
    ) {
      cancelR2BodyBestEffort(object);
      return unavailable(c);
    }

    const json = await object.json<unknown>();
    const stats = parseTopStatsJson(json);
    if (!stats) {
      cancelR2BodyBestEffort(object);
      return unavailable(c);
    }

    const response = c.json(
      { stats },
      200,
      HEADERS as unknown as Record<string, string>,
    );

    if (cache && cacheKey) {
      const write = cache.put(cacheKey, response.clone()).catch(() => undefined);
      if (typeof c.executionCtx?.waitUntil === "function") {
        c.executionCtx.waitUntil(write);
      } else {
        await write;
      }
    }

    return response;
  } catch (error) {
    console.warn("[about-stats] compact R2 stats read failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return unavailable(c);
  }
});
