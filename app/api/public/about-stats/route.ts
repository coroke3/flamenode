import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import {
  normalizeStaticTop,
  type StaticTopPayload,
} from "@/lib/publicData/staticTopCore";

const TOP_OBJECT_KEY = "top.json";
const MAX_TOP_BYTES = 8 * 1024 * 1024;
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
    const object = await bucket.get(TOP_OBJECT_KEY);
    if (!object || object.size > MAX_TOP_BYTES) return unavailable();

    const payload = await object.json<StaticTopPayload>();
    const top = normalizeStaticTop(payload);
    if (!top) return unavailable();

    return NextResponse.json(
      {
        stats: {
          publicVideos: top.stats.publicVideos,
          creators: top.stats.creators,
          events: top.stats.publicEvents ?? top.stats.activeEvents,
        },
      },
      { headers: HEADERS },
    );
  } catch (error) {
    console.warn("[about-stats] R2 read failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return unavailable();
  }
}
