import "server-only";

import { getDatabase, getEnv } from "@/lib/cloudflare";
import { getPublicDataStrategy } from "@/lib/operationMode/policy";
import { resolvePublicOperationMode } from "@/lib/operationMode/publicMode";
import type { PublicDataStrategy } from "@/lib/operationMode/types";
import { enqueueStaticRebuild } from "@/lib/staticRebuild/enqueue";
import type { StaticRebuildTargetType } from "@/lib/staticRebuild/types";
import { publicStaticTargetExists } from "./staticMissPolicy";
import {
  normalizeStaticEventDetail,
  type StaticEventDetail,
  type StaticEventDetailPayload,
} from "./staticEventDetailCore";
import {
  normalizeStaticEventsIndex,
  type StaticEventsIndex,
  type StaticEventsIndexPayload,
} from "./staticEventsIndexCore";
import {
  normalizeStaticPopularVideoPage,
  type StaticPopularVideosPayload,
} from "./staticPopularVideoCore";
import {
  normalizeStaticRecentVideoPage,
  type StaticRecentVideoPage,
  type StaticRecentVideosPayload,
} from "./staticRecentVideoCore";
import {
  normalizeStaticRules,
  type StaticRulesData,
  type StaticRulesPayload,
} from "./staticRulesCore";
import {
  normalizeStaticSearchIndexPayload,
  searchStaticIndexVideos,
  type StaticSearchIndexPayload,
} from "./staticSearchIndexCore";
import {
  normalizeStaticRecommend,
  type StaticRecommendPayload,
  type StaticRecommendPools,
} from "./staticRecommendCore";
import {
  normalizeStaticTop,
  type StaticTopData,
  type StaticTopPayload,
} from "./staticTopCore";
import {
  normalizeStaticUsersIndex,
  type StaticUsersIndex,
  type StaticUsersIndexPayload,
} from "./staticUsersIndexCore";
import {
  normalizeStaticUserProfile,
  type StaticUserProfile,
  type StaticUserProfilePayload,
} from "./staticUserProfileCore";
import {
  normalizeStaticVideoDetail,
  type StaticVideoDetail,
  type StaticVideoDetailPayload,
} from "./staticVideoDetailCore";
import {
  canFallbackToDatabase,
  isMaintenanceStrategy,
  shouldUseStaticCollection,
} from "./loaderPolicy";

export { canFallbackToDatabase, isMaintenanceStrategy };

export type PublicJsonLoadOptions = {
  r2Key: string;
  targetType: StaticRebuildTargetType;
  targetId: string;
  reason: string;
};

export type PublicJsonLoadResult<T> = {
  data: T | null;
  source: "static" | "miss";
  strategy: PublicDataStrategy;
  enqueued: boolean;
};

type PublicJsonLoaderConfig<TPayload, TResult> = {
  r2Key: (id: string) => string;
  targetType: StaticRebuildTargetType;
  targetId?: (id: string) => string;
  reason: string;
  normalize: (payload: TPayload) => TResult | null;
};

const staticReadInFlight = new Map<string, Promise<unknown | null>>();

function warnPublicStaticJson(
  key: string,
  result:
    | "invalid_json"
    | "read_failed"
    | "target_probe_failed"
    | "enqueue_failed",
  error?: unknown,
): void {
  console.warn(
    JSON.stringify({
      service: "public-static-json",
      object_key: key.slice(0, 240),
      result,
      error_name: error instanceof Error ? error.name : undefined,
    }),
  );
}

async function readStaticJson<T>(key: string): Promise<T | null> {
  const existing = staticReadInFlight.get(key);
  if (existing) return existing as Promise<T | null>;

  const pending = (async (): Promise<T | null> => {
    try {
      const bucket = getEnv().BUCKET;
      if (!bucket) return null;
      const object = await bucket.get(key);
      if (!object) return null;
      try {
        return (await object.json()) as T;
      } catch (error) {
        warnPublicStaticJson(key, "invalid_json", error);
        return null;
      }
    } catch (error) {
      warnPublicStaticJson(key, "read_failed", error);
      return null;
    }
  })();

  staticReadInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (staticReadInFlight.get(key) === pending) {
      staticReadInFlight.delete(key);
    }
  }
}

export function createPublicJsonLoader<TPayload, TResult>({
  r2Key,
  targetType,
  targetId = (id) => id,
  reason,
  normalize,
}: PublicJsonLoaderConfig<TPayload, TResult>) {
  return async (id: string): Promise<PublicJsonLoadResult<TResult>> => {
    const result = await loadPublicJson<TPayload>({
      r2Key: r2Key(id),
      targetType,
      targetId: targetId(id),
      reason,
    });
    return {
      ...result,
      data: result.data == null ? null : normalize(result.data),
    };
  };
}

export async function loadPublicJson<T>(
  options: PublicJsonLoadOptions,
): Promise<PublicJsonLoadResult<T>> {
  const payload = await readStaticJson<T>(options.r2Key);
  if (payload !== null) {
    const mode = await resolvePublicOperationMode({ allowD1: false });
    const strategy = getPublicDataStrategy(mode);
    return { data: payload, source: "static", strategy, enqueued: false };
  }

  const db = getDatabase();
  const mode = await resolvePublicOperationMode({ allowD1: true, db });
  const strategy = getPublicDataStrategy(mode);

  if (strategy === "maintenance") {
    return { data: null, source: "miss", strategy, enqueued: false };
  }

  let enqueued = false;
  if (db) {
    let targetExists = false;
    try {
      targetExists = await publicStaticTargetExists(
        db,
        options.targetType,
        options.targetId,
      );
    } catch (error) {
      warnPublicStaticJson(options.targetType, "target_probe_failed", error);
    }

    if (targetExists) {
      const priority = strategy === "static_json_only" ? "high" : "normal";
      try {
        await enqueueStaticRebuild(db, {
          targetType: options.targetType,
          targetId: options.targetId,
          reason: options.reason,
          priority,
        });
        enqueued = true;
      } catch (error) {
        warnPublicStaticJson(options.r2Key, "enqueue_failed", error);
      }
    }
  }

  return { data: null, source: "miss", strategy, enqueued };
}

export const loadStaticEventDetail = createPublicJsonLoader<
  StaticEventDetailPayload,
  StaticEventDetail
>({
  r2Key: (eventId) => `events/${eventId}.json`,
  targetType: "event",
  reason: "public_event_detail_miss",
  normalize: normalizeStaticEventDetail,
});

export async function loadStaticEventsIndex(): Promise<{
  index: StaticEventsIndex | null;
  strategy: PublicDataStrategy;
  enqueued: boolean;
}> {
  const result = await loadPublicJson<StaticEventsIndexPayload>({
    r2Key: "events/index.json",
    targetType: "events_index",
    targetId: "global",
    reason: "public_events_index_miss",
  });
  return {
    index: result.data ? normalizeStaticEventsIndex(result.data) : null,
    strategy: result.strategy,
    enqueued: result.enqueued,
  };
}

export async function loadStaticRecentVideosPage(params: {
  page: number;
  pageSize: number;
}): Promise<
  PublicJsonLoadResult<StaticRecentVideoPage> & {
    page: StaticRecentVideoPage | null;
  }
> {
  const result = await loadPublicJson<StaticRecentVideosPayload>({
    r2Key: "list/recent.json",
    targetType: "list_recent",
    targetId: "global",
    reason: "public_list_miss",
  });
  const normalizedPage = result.data
    ? normalizeStaticRecentVideoPage(result.data, params.page, params.pageSize)
    : null;
  const page =
    normalizedPage &&
    shouldUseStaticCollection(result.strategy, normalizedPage.videos.length)
      ? normalizedPage
      : null;
  return { ...result, data: page, page };
}

export async function loadStaticPopularVideosPage(params: {
  page: number;
  pageSize: number;
}): Promise<
  PublicJsonLoadResult<StaticRecentVideoPage> & {
    page: StaticRecentVideoPage | null;
  }
> {
  const result = await loadPublicJson<StaticPopularVideosPayload>({
    r2Key: "list/popular.json",
    targetType: "list_popular",
    targetId: "global",
    reason: "public_list_popular_miss",
  });
  const normalizedPage = result.data
    ? normalizeStaticPopularVideoPage(result.data, params.page, params.pageSize)
    : null;
  const page =
    normalizedPage &&
    shouldUseStaticCollection(result.strategy, normalizedPage.videos.length)
      ? normalizedPage
      : null;
  return { ...result, data: page, page };
}

export async function loadStaticSearchVideosPage(params: {
  q: string;
  sort: "new" | "old" | "score";
  page: number;
  pageSize: number;
}): Promise<
  PublicJsonLoadResult<StaticRecentVideoPage> & {
    page: StaticRecentVideoPage | null;
  }
> {
  const result = await loadPublicJson<StaticSearchIndexPayload>({
    r2Key: "search-index-lite.json",
    targetType: "search_index",
    targetId: "global",
    reason: "public_list_search_miss",
  });
  const payload = result.data ? normalizeStaticSearchIndexPayload(result.data) : null;
  const normalizedPage = payload
    ? searchStaticIndexVideos({
        payload,
        q: params.q,
        sort: params.sort,
        page: params.page,
        pageSize: params.pageSize,
      })
    : null;
  const page =
    normalizedPage &&
    shouldUseStaticCollection(result.strategy, normalizedPage.videos.length)
      ? normalizedPage
      : null;
  return { ...result, data: page, page };
}

export async function loadStaticRulesPage(): Promise<
  PublicJsonLoadResult<StaticRulesData> & { rules: StaticRulesData | null }
> {
  const result = await loadPublicJson<StaticRulesPayload>({
    r2Key: "rules/current.json",
    targetType: "rules",
    targetId: "global",
    reason: "public_rules_miss",
  });
  const rules = result.data ? normalizeStaticRules(result.data) : null;
  return { ...result, data: rules, rules };
}

export async function loadStaticTopPage(): Promise<
  PublicJsonLoadResult<StaticTopData> & { top: StaticTopData | null }
> {
  const result = await loadPublicJson<StaticTopPayload>({
    r2Key: "top.json",
    targetType: "top",
    targetId: "global",
    reason: "public_top_miss",
  });
  const top = result.data ? normalizeStaticTop(result.data) : null;
  return { ...result, data: top, top };
}

export async function loadStaticUsersIndex(): Promise<
  PublicJsonLoadResult<StaticUsersIndex> & { index: StaticUsersIndex | null }
> {
  const result = await loadPublicJson<StaticUsersIndexPayload>({
    r2Key: "users/index.json",
    targetType: "users_index",
    targetId: "global",
    reason: "public_users_index_miss",
  });
  const normalized = result.data ? normalizeStaticUsersIndex(result.data) : null;
  const index =
    normalized &&
    shouldUseStaticCollection(result.strategy, normalized.items.length)
      ? normalized
      : null;
  return { ...result, data: index, index };
}

export async function loadStaticRecommendPage(): Promise<
  PublicJsonLoadResult<StaticRecommendPools> & {
    recommend: StaticRecommendPools | null;
  }
> {
  const result = await loadPublicJson<StaticRecommendPayload>({
    r2Key: "recommend.json",
    targetType: "recommend",
    targetId: "global",
    reason: "public_recommend_miss",
  });
  const normalized = result.data ? normalizeStaticRecommend(result.data) : null;
  const recommend =
    normalized &&
    shouldUseStaticCollection(
      result.strategy,
      normalized.recommended.length +
        normalized.latest.length +
        normalized.underrated.length +
        normalized.creators.length,
    )
      ? normalized
      : null;
  return { ...result, data: recommend, recommend };
}

export const loadStaticUserProfile = createPublicJsonLoader<
  StaticUserProfilePayload,
  StaticUserProfile
>({
  r2Key: (xUserId) => `users/${xUserId}.json`,
  targetType: "user",
  reason: "public_user_profile_miss",
  normalize: normalizeStaticUserProfile,
});

export const loadStaticVideoDetail = createPublicJsonLoader<
  StaticVideoDetailPayload,
  StaticVideoDetail
>({
  r2Key: (videoId) => `videos/${videoId}.json`,
  targetType: "video",
  reason: "public_video_detail_miss",
  normalize: normalizeStaticVideoDetail,
});

export type {
  StaticEventDetail,
  StaticEventDetailVideo,
} from "./staticEventDetailCore";
export type {
  StaticEventGroupSection,
  StaticEventIndexEvent,
  StaticEventsIndex,
} from "./staticEventsIndexCore";
export type { StaticRecentVideoPage } from "./staticRecentVideoCore";
export type { StaticRecommendPools } from "./staticRecommendCore";
export type { StaticTopData } from "./staticTopCore";
export type { StaticUsersIndex, StaticUsersIndexEntry } from "./staticUsersIndexCore";
export type { StaticUserProfile } from "./staticUserProfileCore";
export type { StaticVideoDetail } from "./staticVideoDetailCore";
