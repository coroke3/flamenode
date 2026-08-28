import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
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

export async function GET(): Promise<Response> {
  try {
    const bucket = getEnv().BUCKET;
    const object = await bucket.get(TOP_STATS_OBJECT_KEY);
    if (!object || object.size > MAX_STATS_BYTES) return unavailable();

    const stats = normalizeTopStatsSection(await object.json<unknown>());
    if (!stats) return unavailable();

    return NextResponse.json(
      {
        stats: {
          publicVideos: stats.stats.public_videos,
          creators: stats.stats.creators,
          events: stats.stats.public_events,
        },
      },
      { headers: HEADERS },
    );
  } catch (error) {
    console.warn("[about-stats] compact R2 stats read failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return unavailable();
  }
}
