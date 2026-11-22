import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { isEntityBlockedInManifest } from "./publicVisibilityManifestCore";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  resolvePublicVisibilityGuardModeFromEnv,
} from "./publicVisibilityManifest";

import { PUBLIC_JSON_CACHE_TTL_SEC } from "./publicJsonCacheTtl";
import { loadStaticJsonFreshStaleUnavailable } from "./staticSharedInputsLoader";
import {
  normalizeStaticTrending,
  filterStaticTrendingByVisibilityFence,
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

function normalizeTrendingPayload(value: unknown, nowSec: number): StaticTrendingData | null {
  if (!value || typeof value !== "object") return null;
  return normalizeStaticTrending(value as StaticTrendingPayload, nowSec);
}

// Writer側は最大200件。通常生成物を十分に上回る余裕を持たせつつ、
// 壊れた巨大artifactをpublic requestでJSON parseしない。
const TRENDING_MAX_OBJECT_BYTES = 1024 * 1024;

/**
 * Read the actual OpenNext request's Worker var, not process.env alone.
 * A Worker-level "enforce" must not silently inherit the Node "observe"
 * default when the two runtime configuration sources differ.
 */
function resolveTrendingGuardMode(): ReturnType<typeof resolvePublicVisibilityGuardModeFromEnv> {
  try {
    const env = getCloudflareContext().env as unknown as {
      PUBLIC_VISIBILITY_GUARD_MODE?: string;
    };
    return resolvePublicVisibilityGuardModeFromEnv({
      PUBLIC_VISIBILITY_GUARD_MODE: env?.PUBLIC_VISIBILITY_GUARD_MODE,
    });
  } catch {
    // Build/local invocations without an OpenNext request context.
    return resolvePublicVisibilityGuardModeFromEnv();
  }
}

/** R2 `analytics/trending.json` のみ読み取る。D1 fallback なし。 */
export async function loadStaticTrending(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<StaticTrendingLoadResult> {
  const loaded = await loadStaticJsonFreshStaleUnavailable<StaticTrendingData>({
    key: TRENDING_OBJECT_KEY,
    normalize: (value) => normalizeTrendingPayload(value, nowSec),
    maxStaleAgeSec: TRENDING_STALE_MAX_AGE_SEC,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.trending,
    maxObjectBytes: TRENDING_MAX_OBJECT_BYTES,
    cacheMode: "cache_first",
    nowSec,
  });
  let data = loaded.value;
  if (data && resolveTrendingGuardMode() === "enforce") {
    try {
      // Cache-first and 3h stale fallback can replay an R2 snapshot produced
      // before a video or its linked event was depublicized. Never trust only
      // the artifact's embedded "public" status when enforcement is enabled.
      const { manifest, etag } = await readPublicVisibilityBlockedEntitiesManifest();
      // The shared cached loader applies its missing-object check using
      // process.env. Worker mode may differ; check the committed R2 object's
      // ETag here so an empty bootstrap manifest cannot authorize stale cards.
      if (!etag?.trim()) throw new Error("trending_visibility_manifest_missing");
      data = filterStaticTrendingByVisibilityFence(data, (entityType, entityId) =>
        isEntityBlockedInManifest(manifest, entityType, entityId));
    } catch {
      // A missing/invalid visibility manifest in enforce mode is not proof of
      // public eligibility. Fail closed without reflecting provider details.
      data = null;
    }
  }
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
