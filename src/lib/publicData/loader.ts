import "server-only";

import { getDatabase, getEnv } from "@/lib/cloudflare";
import {
  logPublicRequestMetrics,
  notePublicDataMode,
  recordPublicD1Query,
  recordPublicR2Get,
  recordPublicStaticHit,
  recordPublicStaticMiss,
  runWithPublicRequestMetrics,
} from "@/lib/observability/publicRequestMetrics";
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
  normalizeStaticUserVideoPage,
  STATIC_USER_COLLABS_PAGE_SIZE,
  STATIC_USER_WORKS_PAGE_SIZE,
  type StaticUserProfile,
  type StaticUserProfilePayload,
  type StaticUserVideoPage,
  type StaticUserVideoPagePayload,
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
import { canAttemptDegradedD1 } from "./degradedPolicy";
import {
  fetchDegradedEventDetailPayload,
  fetchDegradedEventListPage,
  fetchDegradedEventsIndexPayload,
  fetchDegradedRecentListPayload,
  fetchDegradedRecommendPayload,
  fetchDegradedPopularListPayload,
  fetchDegradedRulesPayload,
  fetchDegradedTopPayload,
  fetchDegradedUserProfilePayload,
  fetchDegradedUsersIndexPayload,
  fetchDegradedVideoDetailPayload,
} from "./degradedQueries";
import {
  readPublicJsonCache,
  writePublicJsonCacheBestEffort,
} from "./publicCache";
import {
  toPublicJsonLegacySource,
  type PublicDataMode,
} from "./publicDataMode";

export { canFallbackToDatabase, isMaintenanceStrategy };
export {
  logPublicRequestMetrics,
  notePublicDataMode,
  runWithPublicRequestMetrics,
  setPublicRequestRoute,
} from "@/lib/observability/publicRequestMetrics";
export type { PublicDataMode } from "./publicDataMode";
export { isDegradedD1Mode, isPublicDataUnavailable } from "./publicDataMode";

export type PublicJsonLoadOptions<TPayload = unknown> = {
  r2Key: string;
  targetType: StaticRebuildTargetType;
  targetId: string;
  reason: string;
  cacheTtlSeconds?: number;
  degradedFetcher?: () => Promise<TPayload | null>;
  /** overlay 時に空コレクションを semantic miss として扱う */
  isEmptyCollection?: (payload: TPayload) => boolean;
};

type ResolvePublicJsonMissOptions = {
  skipStaticMissRecord?: boolean;
};

export type PublicJsonLoadResult<T> = {
  data: T | null;
  mode: PublicDataMode;
  /** @deprecated Use `mode`. */
  source: "static" | "miss";
  strategy: PublicDataStrategy;
  enqueued: boolean;
};

type PublicJsonLoaderConfig<TPayload, TResult> = {
  r2Key: (id: string) => string;
  targetType: StaticRebuildTargetType;
  targetId?: (id: string) => string;
  reason: string;
  cacheTtlSeconds?: number;
  normalize: (payload: TPayload) => TResult | null;
  degradedFetcher?: (id: string) => Promise<TPayload | null>;
};

function buildStaticHitResult<T>(
  payload: T,
  mode: Extract<PublicDataMode, "static" | "cached_static">,
  strategy: PublicDataStrategy,
): PublicJsonLoadResult<T> {
  notePublicDataMode(mode);
  return {
    data: payload,
    mode,
    source: toPublicJsonLegacySource(mode),
    strategy,
    enqueued: false,
  };
}

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
  try {
    const bucket = getEnv().BUCKET;
    if (!bucket) return null;
    recordPublicR2Get();
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
}

const PUBLIC_MISS_HIGH_PRIORITY_TARGET_TYPES = new Set<StaticRebuildTargetType>([
  "user",
  "users_index",
  "list_recent",
  "list_popular",
  "search_index",
]);

function resolvePublicMissEnqueuePriority(
  strategy: PublicDataStrategy,
  targetType: StaticRebuildTargetType,
): "high" | "normal" {
  if (strategy === "static_json_only") return "high";
  if (PUBLIC_MISS_HIGH_PRIORITY_TARGET_TYPES.has(targetType)) return "high";
  return "normal";
}

async function resolvePublicJsonMiss<T = never>(
  options: PublicJsonLoadOptions<T>,
  missOptions?: ResolvePublicJsonMissOptions,
): Promise<PublicJsonLoadResult<T>> {
  if (!missOptions?.skipStaticMissRecord) {
    recordPublicStaticMiss();
  }
  const db = getDatabase();
  const mode = await resolvePublicOperationMode({ allowD1: true, db });
  const strategy = getPublicDataStrategy(mode);

  if (strategy === "maintenance") {
    return {
      data: null,
      mode: "unavailable",
      source: "miss",
      strategy,
      enqueued: false,
    };
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
      recordPublicD1Query();
    } catch (error) {
      warnPublicStaticJson(options.targetType, "target_probe_failed", error);
    }

    if (targetExists) {
      const priority = resolvePublicMissEnqueuePriority(
        strategy,
        options.targetType,
      );
      try {
        await enqueueStaticRebuild(db, {
          targetType: options.targetType,
          targetId: options.targetId,
          reason: options.reason,
          priority,
        });
        recordPublicD1Query();
        enqueued = true;
      } catch (error) {
        warnPublicStaticJson(options.r2Key, "enqueue_failed", error);
      }
    }
  }

  if (options.degradedFetcher && canAttemptDegradedD1(strategy) && db) {
    try {
      const degraded = await options.degradedFetcher();
      if (degraded != null) {
        notePublicDataMode("degraded_d1");
        return {
          data: degraded,
          mode: "degraded_d1",
          source: "miss",
          strategy,
          enqueued,
        };
      }
    } catch (error) {
      warnPublicStaticJson(options.r2Key, "read_failed", error);
    }
  }

  return {
    data: null,
    mode: "unavailable",
    source: "miss",
    strategy,
    enqueued,
  };
}

export function createPublicJsonLoader<TPayload, TResult>({
  r2Key,
  targetType,
  targetId = (id) => id,
  reason,
  cacheTtlSeconds,
  normalize,
  degradedFetcher,
}: PublicJsonLoaderConfig<TPayload, TResult>) {
  return async (id: string): Promise<PublicJsonLoadResult<TResult>> => {
    const options: PublicJsonLoadOptions<TPayload> = {
      r2Key: r2Key(id),
      targetType,
      targetId: targetId(id),
      reason,
      cacheTtlSeconds,
      degradedFetcher: degradedFetcher
        ? () => degradedFetcher(id)
        : undefined,
    };
    const result = await loadPublicJson<TPayload>(options);
    if (result.data == null) {
      return { ...result, data: null };
    }
    const normalized = normalize(result.data);
    if (normalized != null) {
      return { ...result, data: normalized };
    }
    return resolvePublicJsonMiss<TResult>(
      options as unknown as PublicJsonLoadOptions<TResult>,
      { skipStaticMissRecord: true },
    );
  };
}

export async function loadPublicJson<T>(
  options: PublicJsonLoadOptions<T>,
): Promise<PublicJsonLoadResult<T>> {
  const cached = await readPublicJsonCache<T>(options.r2Key);
  if (cached !== null) {
    if (options.isEmptyCollection?.(cached)) {
      return resolvePublicJsonMiss(options, { skipStaticMissRecord: true });
    }
    recordPublicStaticHit();
    const operationMode = await resolvePublicOperationMode({ allowD1: false });
    const strategy = getPublicDataStrategy(operationMode);
    return buildStaticHitResult(cached, "cached_static", strategy);
  }

  const payload = await readStaticJson<T>(options.r2Key);
  if (payload !== null) {
    if (options.isEmptyCollection?.(payload)) {
      return resolvePublicJsonMiss(options, { skipStaticMissRecord: true });
    }
    recordPublicStaticHit();
    const operationMode = await resolvePublicOperationMode({ allowD1: false });
    const strategy = getPublicDataStrategy(operationMode);
    if (options.cacheTtlSeconds) {
      writePublicJsonCacheBestEffort(
        options.r2Key,
        payload,
        options.cacheTtlSeconds,
      );
    }
    return buildStaticHitResult(payload, "static", strategy);
  }

  return resolvePublicJsonMiss(options);
}

function isEmptyItemsCollection(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  const items = (payload as { items?: unknown }).items;
  return !Array.isArray(items) || items.length === 0;
}

function isEmptySearchIndexCollection(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  const videos = (payload as { videos?: unknown }).videos;
  return !Array.isArray(videos) || videos.length === 0;
}

function isEmptyTopCollection(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  const row = payload as StaticTopPayload;
  const hasItems = (value: unknown) => Array.isArray(value) && value.length > 0;
  return !(
    hasItems(row.recommended) ||
    hasItems(row.latest) ||
    hasItems(row.nostalgic) ||
    hasItems(row.items) ||
    hasItems(row.active_events) ||
    hasItems(row.latest_events) ||
    hasItems(row.creators) ||
    hasItems(row.announcements)
  );
}

function isEmptyRecommendCollection(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  const row = payload as StaticRecommendPayload;
  const hasItems = (value: unknown) => Array.isArray(value) && value.length > 0;
  return !(
    hasItems(row.recommended) ||
    hasItems(row.latest) ||
    hasItems(row.underrated) ||
    hasItems(row.creators)
  );
}

function countStaticTopItems(top: StaticTopData): number {
  return (
    top.activeEvents.length +
    top.recommended.length +
    top.latest.length +
    top.nostalgic.length
  );
}

function sortRecentPayloadForList(
  payload: StaticRecentVideosPayload,
  sort: "new" | "old" | "score",
): StaticRecentVideosPayload {
  if (sort !== "old" || !Array.isArray(payload.items)) {
    return payload;
  }
  const items = [...payload.items].sort((left, right) => {
    const leftRow = left as { scheduled_time?: unknown };
    const rightRow = right as { scheduled_time?: unknown };
    const leftTime = Number(leftRow.scheduled_time ?? 0);
    const rightTime = Number(rightRow.scheduled_time ?? 0);
    return leftTime - rightTime;
  });
  return { ...payload, items };
}


export const loadStaticEventDetail = createPublicJsonLoader<
  StaticEventDetailPayload,
  StaticEventDetail
>({
  r2Key: (eventId) => `events/${eventId}.json`,
  targetType: "event",
  reason: "public_event_detail_miss",
  cacheTtlSeconds: 120,
  normalize: normalizeStaticEventDetail,
  degradedFetcher: async (eventId) => {
    const db = getDatabase();
    if (!db) return null;
    return fetchDegradedEventDetailPayload(db, eventId);
  },
});

export async function loadStaticEventsIndex(): Promise<{
  index: StaticEventsIndex | null;
  strategy: PublicDataStrategy;
  mode: PublicDataMode;
  enqueued: boolean;
}> {
  const result = await loadPublicJson<StaticEventsIndexPayload>({
    r2Key: "events/index.json",
    targetType: "events_index",
    targetId: "global",
    reason: "public_events_index_miss",
    cacheTtlSeconds: 120,
    isEmptyCollection: isEmptyItemsCollection,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedEventsIndexPayload(db);
    },
  });
  const normalized = result.data ? normalizeStaticEventsIndex(result.data) : null;
  const index =
    normalized &&
    (result.mode === "degraded_d1" ||
      shouldUseStaticCollection(result.strategy, normalized.events.length))
      ? normalized
      : null;
  return {
    index,
    strategy: result.strategy,
    mode: result.mode,
    enqueued: result.enqueued,
  };
}

export async function loadStaticRecentVideosPage(params: {
  page: number;
  pageSize: number;
  q?: string;
  sort?: "new" | "old" | "score";
}): Promise<
  PublicJsonLoadResult<StaticRecentVideoPage> & {
    page: StaticRecentVideoPage | null;
  }
> {
  const sort = params.sort ?? "new";
  const loadOptions: PublicJsonLoadOptions<StaticRecentVideosPayload> = {
    r2Key: "list/recent.json",
    targetType: "list_recent",
    targetId: "global",
    reason: "public_list_miss",
    cacheTtlSeconds: 60,
    isEmptyCollection: isEmptyItemsCollection,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedRecentListPayload(db, {
        page: params.page,
        pageSize: params.pageSize,
        q: params.q,
        sort,
      });
    },
  };
  let result = await loadPublicJson<StaticRecentVideosPayload>(loadOptions);
  const poolSize = Array.isArray(result.data?.items) ? result.data.items.length : 0;
  const payloadForNormalize =
    result.data && sort === "old"
      ? sortRecentPayloadForList(result.data, sort)
      : result.data;
  const normalizedPage = payloadForNormalize
    ? normalizeStaticRecentVideoPage(
        payloadForNormalize,
        params.page,
        params.pageSize,
      )
    : null;
  if (
    normalizedPage &&
    result.mode !== "degraded_d1" &&
    !shouldUseStaticCollection(result.strategy, poolSize)
  ) {
    result = await resolvePublicJsonMiss(loadOptions, {
      skipStaticMissRecord: true,
    });
    const degradedPayload = result.data
      ? sortRecentPayloadForList(result.data, sort)
      : null;
    const degradedPage = degradedPayload
      ? normalizeStaticRecentVideoPage(
          degradedPayload,
          params.page,
          params.pageSize,
        )
      : null;
    return { ...result, data: degradedPage, page: degradedPage };
  }
  const page =
    normalizedPage &&
    (result.mode === "degraded_d1" ||
      shouldUseStaticCollection(result.strategy, poolSize))
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
  const loadOptions: PublicJsonLoadOptions<StaticPopularVideosPayload> = {
    r2Key: "list/popular.json",
    targetType: "list_popular",
    targetId: "global",
    reason: "public_list_popular_miss",
    cacheTtlSeconds: 60,
    isEmptyCollection: isEmptyItemsCollection,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedPopularListPayload(db, {
        page: params.page,
        pageSize: params.pageSize,
      });
    },
  };
  let result = await loadPublicJson<StaticPopularVideosPayload>(loadOptions);
  const poolSize = Array.isArray(result.data?.items) ? result.data.items.length : 0;
  const normalizedPage = result.data
    ? normalizeStaticPopularVideoPage(result.data, params.page, params.pageSize)
    : null;
  if (
    normalizedPage &&
    result.mode !== "degraded_d1" &&
    !shouldUseStaticCollection(result.strategy, poolSize)
  ) {
    result = await resolvePublicJsonMiss(loadOptions, {
      skipStaticMissRecord: true,
    });
    const degradedPage = result.data
      ? normalizeStaticPopularVideoPage(
          result.data,
          params.page,
          params.pageSize,
        )
      : null;
    return { ...result, data: degradedPage, page: degradedPage };
  }
  const page =
    normalizedPage &&
    (result.mode === "degraded_d1" ||
      shouldUseStaticCollection(result.strategy, poolSize))
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
  const loadOptions: PublicJsonLoadOptions<StaticSearchIndexPayload> = {
    r2Key: "search-index-lite.json",
    targetType: "search_index",
    targetId: "global",
    reason: "public_list_search_miss",
    cacheTtlSeconds: 60,
    isEmptyCollection: isEmptySearchIndexCollection,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedRecentListPayload(db, {
        page: params.page,
        pageSize: params.pageSize,
        q: params.q,
        sort: params.sort,
      });
    },
  };
  let result = await loadPublicJson<StaticSearchIndexPayload>(loadOptions);
  if (result.mode === "degraded_d1" && result.data) {
    const degradedPayload = sortRecentPayloadForList(
      result.data as unknown as StaticRecentVideosPayload,
      params.sort,
    );
    const degradedPage = normalizeStaticRecentVideoPage(
      degradedPayload,
      params.page,
      params.pageSize,
    );
    return { ...result, data: degradedPage, page: degradedPage };
  }
  const payload = result.data ? normalizeStaticSearchIndexPayload(result.data) : null;
  const poolSize = Array.isArray(payload?.videos) ? payload.videos.length : 0;
  const normalizedPage = payload
    ? searchStaticIndexVideos({
        payload,
        q: params.q,
        sort: params.sort,
        page: params.page,
        pageSize: params.pageSize,
      })
    : null;
  if (
    normalizedPage &&
    result.mode !== "degraded_d1" &&
    !shouldUseStaticCollection(result.strategy, poolSize)
  ) {
    result = await resolvePublicJsonMiss(loadOptions, {
      skipStaticMissRecord: true,
    });
    if (result.mode === "degraded_d1" && result.data) {
      const degradedPayload = sortRecentPayloadForList(
        result.data as unknown as StaticRecentVideosPayload,
        params.sort,
      );
      const degradedPage = normalizeStaticRecentVideoPage(
        degradedPayload,
        params.page,
        params.pageSize,
      );
      return { ...result, data: degradedPage, page: degradedPage };
    }
    return { ...result, data: null, page: null };
  }
  const page =
    normalizedPage &&
    (result.mode === "degraded_d1" ||
      shouldUseStaticCollection(result.strategy, poolSize))
      ? normalizedPage
      : null;
  return { ...result, data: page, page };
}

export async function loadPublicEventVideosPage(params: {
  eventId: string;
  sort: "new" | "old" | "score";
  page: number;
  pageSize: number;
  q?: string;
}): Promise<
  PublicJsonLoadResult<StaticRecentVideoPage> & {
    page: StaticRecentVideoPage | null;
    eventInfo: { id: string; title: string } | null;
  }
> {
  const db = getDatabase();
  const mode = await resolvePublicOperationMode({ allowD1: true, db });
  const strategy = getPublicDataStrategy(mode);

  if (isMaintenanceStrategy(strategy)) {
    return {
      data: null,
      page: null,
      eventInfo: null,
      mode: "unavailable",
      source: "miss",
      strategy,
      enqueued: false,
    };
  }

  if (!canAttemptDegradedD1(strategy) || !db) {
    return {
      data: null,
      page: null,
      eventInfo: null,
      mode: "unavailable",
      source: "miss",
      strategy,
      enqueued: false,
    };
  }

  try {
    const degraded = await fetchDegradedEventListPage(db, params);
    if (!degraded) {
      return {
        data: null,
        page: null,
        eventInfo: null,
        mode: "unavailable",
        source: "miss",
        strategy,
        enqueued: false,
      };
    }
    notePublicDataMode("degraded_d1");
    const videos = degraded.items.map((item) => ({
      id: item.id,
      title: item.title,
      youtube_video_id: item.youtube_video_id,
      display_name: item.display_name,
      icon_url: item.icon_url ?? null,
      primary_event_id: item.primary_event_id ?? null,
      primary_event_title:
        (item as { primary_event_title?: string | null }).primary_event_title ??
        null,
      scheduled_time: item.scheduled_time ?? null,
      status: "public" as const,
      part: null,
    }));
    const page: StaticRecentVideoPage = {
      videos,
      total: degraded.total,
      generatedAt: null,
    };
    return {
      data: page,
      page,
      eventInfo: degraded.eventInfo,
      mode: "degraded_d1",
      source: "miss",
      strategy,
      enqueued: false,
    };
  } catch (error) {
    warnPublicStaticJson(`list/event/${params.eventId}`, "read_failed", error);
    return {
      data: null,
      page: null,
      eventInfo: null,
      mode: "unavailable",
      source: "miss",
      strategy,
      enqueued: false,
    };
  }
}

export async function loadStaticRulesPage(): Promise<
  PublicJsonLoadResult<StaticRulesData> & { rules: StaticRulesData | null }
> {
  const result = await loadPublicJson<StaticRulesPayload>({
    r2Key: "rules/current.json",
    targetType: "rules",
    targetId: "global",
    reason: "public_rules_miss",
    cacheTtlSeconds: 300,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedRulesPayload(db);
    },
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
    cacheTtlSeconds: 30,
    isEmptyCollection: isEmptyTopCollection,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedTopPayload(db);
    },
  });
  const normalized = result.data ? normalizeStaticTop(result.data) : null;
  const top =
    normalized &&
    (result.mode === "degraded_d1" ||
      shouldUseStaticCollection(result.strategy, countStaticTopItems(normalized)))
      ? normalized
      : null;
  return { ...result, data: top, top };
}

export async function loadStaticUsersIndex(params?: {
  page?: number;
  pageSize?: number;
  q?: string;
}): Promise<
  PublicJsonLoadResult<StaticUsersIndex> & { index: StaticUsersIndex | null }
> {
  const page = Math.max(1, Math.floor(params?.page ?? 1));
  const pageSize = Math.max(1, Math.floor(params?.pageSize ?? 48));
  const result = await loadPublicJson<StaticUsersIndexPayload>({
    r2Key: "users/index.json",
    targetType: "users_index",
    targetId: "global",
    reason: "public_users_index_miss",
    cacheTtlSeconds: 60,
    isEmptyCollection: isEmptyItemsCollection,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedUsersIndexPayload(db, {
        page,
        pageSize,
        q: params?.q,
      });
    },
  });
  const normalized = result.data ? normalizeStaticUsersIndex(result.data) : null;
  const index =
    normalized &&
    (result.mode === "degraded_d1" ||
      shouldUseStaticCollection(result.strategy, normalized.items.length))
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
    cacheTtlSeconds: 60,
    isEmptyCollection: isEmptyRecommendCollection,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedRecommendPayload(db);
    },
  });
  const normalized = result.data ? normalizeStaticRecommend(result.data) : null;
  const recommend =
    normalized &&
    (result.mode === "degraded_d1" ||
      shouldUseStaticCollection(
        result.strategy,
        normalized.recommended.length +
          normalized.latest.length +
          normalized.underrated.length +
          normalized.creators.length,
      ))
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
  cacheTtlSeconds: 120,
  normalize: normalizeStaticUserProfile,
  degradedFetcher: async (xUserId) => {
    const db = getDatabase();
    if (!db) return null;
    return fetchDegradedUserProfilePayload(db, xUserId);
  },
});

function profileSectionToPage(
  section: StaticUserProfile["works"],
  generatedAt: number | null,
): StaticUserVideoPage {
  return {
    page: 1,
    total: section.total,
    items: section.items,
    pageSize: section.pageSize,
    generatedAt,
  };
}

export async function loadStaticUserWorksPage(params: {
  userId: string;
  page: number;
  profile?: StaticUserProfile | null;
  strategy?: PublicDataStrategy;
}): Promise<
  PublicJsonLoadResult<StaticUserVideoPage> & {
    page: StaticUserVideoPage | null;
  }
> {
  const pageNum = Math.max(1, Math.floor(params.page));
  if (pageNum === 1 && params.profile) {
    const normalized = profileSectionToPage(
      params.profile.works,
      params.profile.generatedAt,
    );
    return {
      data: normalized,
      page: normalized,
      mode: "static",
      source: "static",
      strategy: params.strategy ?? "static_json_only",
      enqueued: false,
    };
  }

  const result = await loadPublicJson<StaticUserVideoPagePayload>({
    r2Key: `users/${params.userId}/works/${pageNum}.json`,
    targetType: "user",
    targetId: params.userId,
    reason: "public_user_works_page_miss",
  });
  const normalizedPage = result.data
    ? normalizeStaticUserVideoPage(
        result.data,
        pageNum,
        STATIC_USER_WORKS_PAGE_SIZE,
      )
    : null;
  const page =
    normalizedPage &&
    shouldUseStaticCollection(result.strategy, normalizedPage.items.length)
      ? normalizedPage
      : null;
  return { ...result, data: page, page };
}

export async function loadStaticUserCollabsPage(params: {
  userId: string;
  page: number;
  profile?: StaticUserProfile | null;
  strategy?: PublicDataStrategy;
}): Promise<
  PublicJsonLoadResult<StaticUserVideoPage> & {
    page: StaticUserVideoPage | null;
  }
> {
  const pageNum = Math.max(1, Math.floor(params.page));
  if (pageNum === 1 && params.profile) {
    const normalized = profileSectionToPage(
      params.profile.collabs,
      params.profile.generatedAt,
    );
    return {
      data: normalized,
      page: normalized,
      mode: "static",
      source: "static",
      strategy: params.strategy ?? "static_json_only",
      enqueued: false,
    };
  }

  const result = await loadPublicJson<StaticUserVideoPagePayload>({
    r2Key: `users/${params.userId}/collabs/${pageNum}.json`,
    targetType: "user",
    targetId: params.userId,
    reason: "public_user_collabs_page_miss",
  });
  const normalizedPage = result.data
    ? normalizeStaticUserVideoPage(
        result.data,
        pageNum,
        STATIC_USER_COLLABS_PAGE_SIZE,
      )
    : null;
  const page =
    normalizedPage &&
    shouldUseStaticCollection(result.strategy, normalizedPage.items.length)
      ? normalizedPage
      : null;
  return { ...result, data: page, page };
}

export const loadStaticVideoDetail = createPublicJsonLoader<
  StaticVideoDetailPayload,
  StaticVideoDetail
>({
  r2Key: (videoId) => `videos/${videoId}.json`,
  targetType: "video",
  reason: "public_video_detail_miss",
  cacheTtlSeconds: 120,
  normalize: normalizeStaticVideoDetail,
  degradedFetcher: async (videoId) => {
    const db = getDatabase();
    if (!db) return null;
    return fetchDegradedVideoDetailPayload(db, videoId);
  },
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
export type {
  StaticUserProfile,
  StaticUserVideoPage,
  StaticUserVideoSection,
} from "./staticUserProfileCore";
export type { StaticVideoDetail } from "./staticVideoDetailCore";
