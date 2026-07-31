import "server-only";

import { cache } from "react";
import { getEnv } from "@/lib/cloudflare";
import { recordPublicR2Get } from "@/lib/observability/publicRequestMetrics";
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
  normalizePublicXIconMap,
  PUBLIC_X_ICON_MAP_OBJECT_KEY,
  type PublicXIconMapPayload,
} from "./publicIconProjection";
import {
  normalizeStaticUsersIndex,
  type StaticUsersIndexPayload,
} from "./staticUsersIndexCore";
import { normalizeXId } from "../utils/xid";

export type StaticJsonLoadStatus = "fresh" | "stale" | "unavailable";

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
  nowSec?: number;
}): Promise<StaticJsonLoadResult<T | null>> {
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  const cacheTtl = args.cacheTtlSeconds ?? 300;

  const freshCached = coercePublicJsonCacheEnvelope(
    await readPublicJsonCache<unknown>(args.key),
    now,
  );
  if (freshCached) {
    const age = now - freshCached.stored_at;
    if (age >= 0 && age <= cacheTtl) {
      const normalized = args.normalize(freshCached.payload);
      if (normalized !== null) {
        return { status: "fresh", value: normalized };
      }
    }
  }

  const payload = await readR2Json(args.key);
  if (payload !== null) {
    const normalized = args.normalize(payload);
    if (normalized !== null) {
      writePublicJsonCacheBestEffort(
        args.key,
        { payload, stored_at: now },
        Math.max(cacheTtl, args.maxStaleAgeSec),
      );
      return { status: "fresh", value: normalized };
    }
  }

  if (freshCached) {
    const age = now - freshCached.stored_at;
    if (age >= 0 && age <= args.maxStaleAgeSec) {
      const normalized = args.normalize(freshCached.payload);
      if (normalized !== null) {
        return { status: "stale", value: normalized };
      }
    }
  }

  return { status: "unavailable", value: null };
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

/**
 * 公開アイコンは共有mapを正本とし、必要なIDが欠ける場合だけ
 * R2上の users/index.json で補完する。どちらも利用できない場合もD1へは降りない。
 */
const loadPublicXIconMapOptionalImpl = cache(
  async (requiredIdsKey: string): Promise<PublicXIconMapPayload | null> => {
    const requiredXUserIds =
      requiredIdsKey.length === 0 ? [] : requiredIdsKey.split(",");
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
        // registered / none は正本済み。欠損と video（未昇格）だけ index へ降りる。
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
      generated_at:
        primary?.generated_at ?? indexResult.value.generatedAt ?? 0,
      entries,
    };
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
