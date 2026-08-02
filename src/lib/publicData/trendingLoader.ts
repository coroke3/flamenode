import "server-only";

import { getEnv } from "@/lib/cloudflare";
import { recordPublicR2Get } from "@/lib/observability/publicRequestMetrics";
import {
  normalizeStaticTrending,
  resolveStaticTrendingStaleMeta,
  TRENDING_OBJECT_KEY,
  type StaticTrendingData,
  type StaticTrendingPayload,
} from "./staticTrendingCore";

export interface StaticTrendingLoadResult {
  data: StaticTrendingData | null;
  stale: boolean;
  ageSeconds: number | null;
  tooOldForHome: boolean;
  state: "ready" | "empty" | "stale" | "unavailable";
}

async function readTrendingJsonFromR2(): Promise<StaticTrendingPayload | null> {
  try {
    const bucket = getEnv().BUCKET;
    if (!bucket) return null;
    recordPublicR2Get();
    const object = await bucket.get(TRENDING_OBJECT_KEY);
    if (!object) return null;
    try {
      return (await object.json()) as StaticTrendingPayload;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/** R2 `analytics/trending.json` のみ読み取る。D1 fallback なし。 */
export async function loadStaticTrending(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<StaticTrendingLoadResult> {
  const payload = await readTrendingJsonFromR2();
  const data = payload ? normalizeStaticTrending(payload) : null;
  const staleMeta = resolveStaticTrendingStaleMeta(
    data?.generatedAt ?? null,
    nowSec,
  );

  return {
    data,
    ...staleMeta,
    state: !data
      ? "unavailable"
      : data.items.length === 0
        ? "empty"
        : staleMeta.stale
          ? "stale"
          : "ready",
  };
}
