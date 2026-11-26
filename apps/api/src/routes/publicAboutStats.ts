import { normalizeCount } from "@flamenode/server-core/publicData/normalize";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";

// CURRENT: app/api/public/about-stats/route.ts +
// src/lib/publicData/staticTopSectionsCore.ts#normalizeTopStatsSection.
// One bounded R2 GET (<= 64 KiB), no D1.
const MAX_STATS_BYTES = 64 * 1024;
const TOP_STATS_OBJECT_KEY = "top/sections/stats.v1.json";
const TOP_SECTIONS_SCHEMA_VERSION = 1;
const TOP_SECTIONS_MAX_FUTURE_SKEW_SEC = 5 * 60;

const HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
  "X-Content-Type-Options": "nosniff",
} as const;
const UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store",
  "Retry-After": "30",
  "X-Content-Type-Options": "nosniff",
} as const;

type AboutStats = { publicVideos: number; creators: number; events: number };

function unavailable(): Response {
  return Response.json({ stats: null }, { status: 503, headers: UNAVAILABLE_HEADERS });
}

async function cancelR2BodyBestEffort(object: { body?: unknown } | null | undefined): Promise<void> {
  const body = object?.body;
  if (!body || typeof body !== "object") return;
  const cancel = (body as { cancel?: unknown }).cancel;
  if (typeof cancel !== "function") return;
  try {
    await Reflect.apply(cancel, body, []);
  } catch {
    // Resource cleanup only.
  }
}

/** Mirrors normalizeTopStatsSection, projected to the public about-stats DTO. */
export function normalizeAboutStats(value: unknown): AboutStats | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.schema_version !== TOP_SECTIONS_SCHEMA_VERSION) return null;
  const generatedAt = payload.generated_at;
  if (typeof generatedAt !== "number" || !Number.isSafeInteger(generatedAt) || generatedAt <= 0) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (generatedAt > now + TOP_SECTIONS_MAX_FUTURE_SKEW_SEC) return null;
  if (!payload.stats || typeof payload.stats !== "object") return null;
  const stats = payload.stats as Record<string, unknown>;
  return {
    publicVideos: normalizeCount(stats.public_videos) ?? 0,
    creators: normalizeCount(stats.creators) ?? 0,
    events: normalizeCount(stats.public_events) ?? 0,
  };
}

export const publicAboutStatsRoutes = new Hono<AppEnv>();

// RH-026: GET /api/public/about-stats
publicAboutStatsRoutes.get("/", async (c) => {
  const cache =
    typeof caches !== "undefined" && "default" in caches
      ? (caches as unknown as { default?: Cache }).default ?? null
      : null;
  // Fixed key: a query string must not bypass the edge cache.
  const cacheKey = cache
    ? new Request(`${new URL(c.req.url).origin}/api/public/about-stats`, { method: "GET" })
    : null;

  if (cache && cacheKey) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {
      // Cache match failure is non-fatal
    }
  }

  try {
    const bucket = c.env?.BUCKET;
    if (!bucket) return unavailable();
    const object = await bucket.get(TOP_STATS_OBJECT_KEY);
    if (!object) return unavailable();
    if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > MAX_STATS_BYTES) {
      await cancelR2BodyBestEffort(object);
      return unavailable();
    }

    const stats = normalizeAboutStats(await object.json<unknown>());
    if (!stats) return unavailable();

    const response = Response.json({ stats }, { headers: HEADERS });

    if (cache && cacheKey) {
      const write = cache.put(cacheKey, response.clone()).catch(() => undefined);
      let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
      try {
        waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
      } catch {
        // app.request() in tests has no ExecutionContext.
      }
      if (waitUntil) waitUntil(write);
      else await write;
    }

    return response;
  } catch {
    // R2/provider exceptions and diagnostic sinks are untrusted. A failed log
    // must never replace the stable no-store 503 response with a thrown error.
    try {
      console.warn("[about-stats] compact R2 stats read failed");
    } catch {
      // Best-effort diagnostics only.
    }
    return unavailable();
  }
});
