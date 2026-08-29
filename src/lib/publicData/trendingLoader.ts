import "server-only";

import { PUBLIC_JSON_CACHE_TTL_SEC } from "./publicJsonCacheTtl";
import { loadStaticJsonFreshStaleUnavailable } from "./staticSharedInputsLoader";
import {
  normalizeStaticTrending,
  resolveStaticTrendingStaleMeta,
  TRENDING_OBJECT_KEY,
  TRENDING_STALE_MAX_AGE_SEC,
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

function normalizeTrendingPayload(value: unknown): StaticTrendingData | null {
  if (!value || typeof value !== "object") return null;
  return normalizeStaticTrending(value as StaticTrendingPayload);
}

// Writer側は最大200件。通常生成物を十分に上回る余裕を持たせつつ、
// 壊れた巨大artifactをpublic requestでJSON parseしない。
const TRENDING_MAX_OBJECT_BYTES = 1024 * 1024;

/** R2 `analytics/trending.json` のみ読み取る。D1 fallback なし。 */
export async function loadStaticTrending(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<StaticTrendingLoadResult> {
  const loaded = await loadStaticJsonFreshStaleUnavailable<StaticTrendingData>({
    key: TRENDING_OBJECT_KEY,
    normalize: normalizeTrendingPayload,
    maxStaleAgeSec: TRENDING_STALE_MAX_AGE_SEC,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.trending,
    maxObjectBytes: TRENDING_MAX_OBJECT_BYTES,
    cacheMode: "cache_first",
    nowSec,
  });
  const data = loaded.value;
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
