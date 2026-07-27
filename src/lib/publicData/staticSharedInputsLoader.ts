import "server-only";

import { getEnv } from "@/lib/cloudflare";
import { recordPublicR2Get } from "@/lib/observability/publicRequestMetrics";
import {
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

  const freshCached = await readPublicJsonCache<{
    payload: unknown;
    stored_at: number;
  }>(args.key);
  if (freshCached && typeof freshCached.stored_at === "number") {
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

  if (freshCached && typeof freshCached.stored_at === "number") {
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
    cacheTtlSeconds: 300,
  });
  if (result.status === "unavailable" || !result.value) {
    return {
      status: "unavailable",
      value: EMPTY_YOUTUBE_RELATED_BLOCKLIST,
    };
  }
  return { status: result.status, value: result.value };
}

export async function loadPublicXIconMapOptional(): Promise<PublicXIconMapPayload | null> {
  const result = await loadStaticJsonFreshStaleUnavailable({
    key: PUBLIC_X_ICON_MAP_OBJECT_KEY,
    normalize: normalizePublicXIconMap,
    maxStaleAgeSec: 24 * 60 * 60,
    cacheTtlSeconds: 300,
  });
  return result.value;
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
    cacheTtlSeconds: 300,
  });
  if (result.status === "unavailable" || !result.value) {
    return {
      status: "unavailable",
      value: EMPTY_RANDOM_VIDEO_POOL,
    };
  }
  return { status: result.status, value: result.value };
}
