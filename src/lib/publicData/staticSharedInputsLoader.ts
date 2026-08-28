import "server-only";

import { cache } from "react";
import { getEnv } from "@/lib/cloudflare";
import {
  notePublicArtifactMode,
  recordPublicR2Get,
} from "@/lib/observability/publicRequestMetrics";
import { PUBLIC_JSON_CACHE_TTL_SEC } from "./publicJsonCacheTtl";
import {
  coercePublicJsonCacheEnvelope,
  readPublicJsonCache,
  writePublicJsonCacheBestEffort,
} from "./publicCache";
import {
  EMPTY_YOUTUBE_RELATED_BLOCKLIST,
  YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
  YOUTUBE_RELATED_BLOCKLIST_STALE_MAX_AGE_SEC,
  normalizeYoutubeRelatedBlocklist,
  type YoutubeRelatedBlocklist,
} from "./staticYoutubeRelatedBlocklistCore";
import {
  EMPTY_RANDOM_VIDEO_POOL,
  RANDOM_VIDEO_POOL_OBJECT_KEY,
  normalizeRandomVideoPool,
  type RandomVideoPool,
} from "./randomVideoPoolCore";
import {
  normalizePickupCreatorsArtifact,
  PICKUP_CREATORS_OBJECT_KEY,
  type PickupCreatorsArtifact,
} from "./publicCreatorProjection";
import {
  normalizePublicXIconMap,
  PUBLIC_X_ICON_MAP_OBJECT_KEY,
  type PublicXIconMapPayload,
} from "./publicIconProjection";
import {
  normalizePublicXIconV2Manifest,
  normalizePublicXIconV2Shard,
  PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY,
  publicXIconV2ShardForXId,
  publicXIconV2ShardObjectKey,
} from "./publicIconProjectionV2";
import {
  normalizeStaticTopSlotStats,
  TOP_SLOT_STATS_OBJECT_KEY,
  type StaticTopSlotStats,
} from "./staticTopSlotStatsCore";
import {
  normalizeStaticUsersIndex,
  type StaticUsersIndexPayload,
} from "./staticUsersIndexCore";
import { normalizeXId } from "../utils/xid";

export type StaticJsonLoadStatus = "fresh" | "stale" | "unavailable";
export type StaticJsonCacheMode =
  | "default"
  | "cache_first"
  | "r2_first"
  | "bypass";

export type StaticJsonLoadResult<T> = {
  status: StaticJsonLoadStatus;
  value: T;
};

async function readR2Json(key: string): Promise<unknown | null> {
  try {
    const bucket = getEnv().BUCKET;
    if (!bucket) return null;
    recordPublicR2Get();
    const object = await bucket.get(key);
    if (!object) return null;
    try {
      return await object.json();
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * fresh Cache → R2 → stale Cache（最大maxStaleAgeSec）→ unavailable。
 * blocklistは空フォールバック禁止。icon mapは欠損時nullでよい。
 */
export async function loadStaticJsonFreshStaleUnavailable<T>(args: {
  key: string;
  normalize: (value: unknown) => T | null;
  maxStaleAgeSec: number;
  cacheTtlSeconds?: number;
  /** `r2_first` reads R2 first and permits bounded stale Cache fallback. */
  cacheMode?: StaticJsonCacheMode;
  nowSec?: number;
  /** fresh Cache hit 時も R2 を読み、generated_at が新しければ R2 を採用する。 */
  getGeneratedAt?: (value: T) => number;
}): Promise<StaticJsonLoadResult<T | null>> {
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  const cacheTtl = args.cacheTtlSeconds ?? 300;
  const finish = <T>(status: StaticJsonLoadStatus, value: T | null) => {
    notePublicArtifactMode(status);
    return { status, value } satisfies StaticJsonLoadResult<T | null>;
  };

  const cacheMode = args.cacheMode ?? "cache_first";
  const cacheFirst = cacheMode === "default" || cacheMode === "cache_first";
  const freshCached = cacheFirst
    ? coercePublicJsonCacheEnvelope(
        await readPublicJsonCache<unknown>(args.key),
        now,
      )
    : null;
  if (freshCached) {
    const age = now - freshCached.stored_at;
    if (age >= 0 && age <= cacheTtl) {
      const normalized = args.normalize(freshCached.payload);
      if (normalized !== null) {
        if (args.getGeneratedAt) {
          const r2Payload = await readR2Json(args.key);
          if (r2Payload !== null) {
            const r2Normalized = args.normalize(r2Payload);
            if (r2Normalized !== null) {
              const cacheGeneratedAt = args.getGeneratedAt(normalized);
              const r2GeneratedAt = args.getGeneratedAt(r2Normalized);
              if (r2GeneratedAt > cacheGeneratedAt) {
                if (cacheMode !== "bypass") {
                  writePublicJsonCacheBestEffort(
                    args.key,
                    { payload: r2Payload, stored_at: now },
                    Math.max(cacheTtl, args.maxStaleAgeSec),
                  );
                }
                return finish("fresh", r2Normalized);
              }
            }
          }
        }
        return finish("fresh", normalized);
      }
    }
  }

  const payload = await readR2Json(args.key);
  if (payload !== null) {
    const normalized = args.normalize(payload);
    if (normalized !== null) {
      if (cacheMode !== "bypass") {
        writePublicJsonCacheBestEffort(
          args.key,
          { payload, stored_at: now },
          Math.max(cacheTtl, args.maxStaleAgeSec),
        );
      }
      return finish("fresh", normalized);
    }
  }

  if (cacheMode === "r2_first") {
    const staleCached = freshCached ?? coercePublicJsonCacheEnvelope(
      await readPublicJsonCache<unknown>(args.key),
      now,
      { requireStoredAt: true },
    );
    if (staleCached) {
      const age = now - staleCached.stored_at;
      if (age >= 0 && age <= args.maxStaleAgeSec) {
        const normalized = args.normalize(staleCached.payload);
        if (normalized !== null) {
          return finish("stale", normalized);
        }
      }
    }
  } else if (freshCached) {
    const age = now - freshCached.stored_at;
    if (age >= 0 && age <= args.maxStaleAgeSec) {
      const normalized = args.normalize(freshCached.payload);
      if (normalized !== null) {
        return finish("stale", normalized);
      }
    }
  }

  return finish("unavailable", null);
}

export async function loadYoutubeRelatedBlocklist(): Promise<
  StaticJsonLoadResult<YoutubeRelatedBlocklist>
> {
  const result = await loadStaticJsonFreshStaleUnavailable({
    key: YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
    normalize: normalizeYoutubeRelatedBlocklist,
    maxStaleAgeSec: YOUTUBE_RELATED_BLOCKLIST_STALE_MAX_AGE_SEC,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.blocklistPool,
  });
  if (result.status === "unavailable" || !result.value) {
    return {
      status: "unavailable",
      value: EMPTY_YOUTUBE_RELATED_BLOCKLIST,
    };
  }
  return { status: result.status, value: result.value };
}

function buildRequiredXIdsCacheKey(
  requiredXUserIds: readonly (string | null | undefined)[],
): string {
  const ids = requiredXUserIds
    .map(normalizeXId)
    .filter((id): id is string => Boolean(id));
  ids.sort();
  return ids.join(",");
}

async function loadPublicXIconMapV1(
  requiredXUserIds: readonly string[],
): Promise<PublicXIconMapPayload | null> {
  const result = await loadStaticJsonFreshStaleUnavailable({
    key: PUBLIC_X_ICON_MAP_OBJECT_KEY,
    normalize: normalizePublicXIconMap,
    maxStaleAgeSec: 24 * 60 * 60,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.blocklistPool,
  });
  const requiredIds = new Set(requiredXUserIds);
  const primary = result.value;
  const needsIndexFallback =
    !primary ||
    Array.from(requiredIds).some((xId) => {
      const entry = primary.entries[xId];
      if (!entry) return true;
      return entry.source === "video";
    });

  if (!needsIndexFallback) return primary;

  const indexResult = await loadStaticJsonFreshStaleUnavailable({
    key: "users/index.json",
    normalize: (value) =>
      normalizeStaticUsersIndex(value as StaticUsersIndexPayload),
    maxStaleAgeSec: 24 * 60 * 60,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
  });
  if (!indexResult.value) return primary;

  const entries = { ...(primary?.entries ?? {}) };
  for (const user of indexResult.value.items) {
    const xId = normalizeXId(user.x_id);
    if (!xId) continue;
    if (requiredIds.size > 0 && !requiredIds.has(xId)) continue;
    const existing = entries[xId];
    if (existing?.source === "registered" || existing?.source === "none") {
      continue;
    }
    entries[xId] = {
      icon_url: user.icon_url ?? existing?.icon_url ?? null,
      source: user.icon_url ? "registered" : "none",
    };
  }

  return {
    schema_version: 1,
    generated_at: primary?.generated_at ?? indexResult.value.generatedAt ?? 0,
    entries,
  };
}

async function loadPublicXIconMapV2(
  requiredXUserIds: readonly string[],
): Promise<PublicXIconMapPayload | null> {
  if (requiredXUserIds.length === 0) return null;
  const manifestResult = await loadStaticJsonFreshStaleUnavailable({
    key: PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY,
    normalize: normalizePublicXIconV2Manifest,
    maxStaleAgeSec: 24 * 60 * 60,
    cacheTtlSeconds: 60,
  });
  const manifest = manifestResult.value;
  if (!manifest) return null;

  const requiredShards = [
    ...new Set(requiredXUserIds.map(publicXIconV2ShardForXId)),
  ].filter((shard) => manifest.shards.includes(shard));
  if (requiredShards.length === 0) {
    return {
      schema_version: 1,
      generated_at: manifest.generated_at,
      entries: {},
    };
  }

  const results = await Promise.all(
    requiredShards.map(async (shard) =>
      loadStaticJsonFreshStaleUnavailable({
        key: publicXIconV2ShardObjectKey(manifest.generation, shard),
        normalize: (value) =>
          normalizePublicXIconV2Shard(value, {
            generation: manifest.generation,
            shard,
          }),
        maxStaleAgeSec: 24 * 60 * 60,
        cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.blocklistPool,
      }),
    ),
  );
  if (results.some((result) => !result.value)) return null;

  const requiredIds = new Set(requiredXUserIds);
  const entries: PublicXIconMapPayload["entries"] = {};
  for (const result of results) {
    for (const [xId, entry] of Object.entries(result.value?.entries ?? {})) {
      if (requiredIds.has(xId)) entries[xId] = entry;
    }
  }
  return {
    schema_version: 1,
    generated_at: manifest.generated_at,
    entries,
  };
}

/**
 * 公開アイコンはV2の必要shardだけを優先する。V2 rollout中のmanifest/shard欠損は
 * canonical V1へfail-safeし、request pathでD1へは降りない。
 * V1でusers/index補完対象だった「欠損 / source=video」も同じ意味論を維持する。
 */
const loadPublicXIconMapOptionalImpl = cache(
  async (requiredIdsKey: string): Promise<PublicXIconMapPayload | null> => {
    const requiredXUserIds =
      requiredIdsKey.length === 0 ? [] : requiredIdsKey.split(",");
    const v2 = await loadPublicXIconMapV2(requiredXUserIds);
    if (v2) {
      const needsCanonicalFallback = requiredXUserIds.some((xId) => {
        const entry = v2.entries[xId];
        return !entry || entry.source === "video";
      });
      if (!needsCanonicalFallback) return v2;
    }
    return loadPublicXIconMapV1(requiredXUserIds);
  },
);

export async function loadPublicXIconMapOptional(
  requiredXUserIds: readonly (string | null | undefined)[] = [],
): Promise<PublicXIconMapPayload | null> {
  return loadPublicXIconMapOptionalImpl(
    buildRequiredXIdsCacheKey(requiredXUserIds),
  );
}

export async function loadRandomVideoPoolOptional(): Promise<RandomVideoPool> {
  return (await loadRandomVideoPool()).value;
}

export async function loadRandomVideoPool(): Promise<
  StaticJsonLoadResult<RandomVideoPool>
> {
  const result = await loadStaticJsonFreshStaleUnavailable({
    key: RANDOM_VIDEO_POOL_OBJECT_KEY,
    normalize: normalizeRandomVideoPool,
    maxStaleAgeSec: 24 * 60 * 60,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.blocklistPool,
  });
  if (result.status === "unavailable" || !result.value) {
    return {
      status: "unavailable",
      value: EMPTY_RANDOM_VIDEO_POOL,
    };
  }
  return { status: result.status, value: result.value };
}

const EMPTY_PICKUP_CREATORS_ARTIFACT: PickupCreatorsArtifact = {
  schema_version: 1,
  generated_at: 0,
  creators: [],
};

const EMPTY_TOP_SLOT_STATS: StaticTopSlotStats = {
  generatedAt: 0,
  items: new Map(),
};

export async function loadPickupCreatorsArtifact(): Promise<
  StaticJsonLoadResult<PickupCreatorsArtifact>
> {
  const result = await loadStaticJsonFreshStaleUnavailable({
    key: PICKUP_CREATORS_OBJECT_KEY,
    normalize: normalizePickupCreatorsArtifact,
    maxStaleAgeSec: 24 * 60 * 60,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
  });
  if (result.status === "unavailable" || !result.value) {
    return {
      status: "unavailable",
      value: EMPTY_PICKUP_CREATORS_ARTIFACT,
    };
  }
  return { status: result.status, value: result.value };
}

export async function loadStaticTopSlotStats(): Promise<
  StaticJsonLoadResult<StaticTopSlotStats>
> {
  const result = await loadStaticJsonFreshStaleUnavailable({
    key: TOP_SLOT_STATS_OBJECT_KEY,
    normalize: normalizeStaticTopSlotStats,
    maxStaleAgeSec: PUBLIC_JSON_CACHE_TTL_SEC.topSlotStats * 2,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.topSlotStats,
    getGeneratedAt: (value) => value.generatedAt,
  });
  if (result.status === "unavailable" || !result.value) {
    return {
      status: "unavailable",
      value: EMPTY_TOP_SLOT_STATS,
    };
  }
  return { status: result.status, value: result.value };
}
