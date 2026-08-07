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
import { directEnqueueStaticRebuild } from "@/lib/staticRebuild/enqueue";
import type {
  RebuildRequestState,
  StaticRebuildTargetType,
} from "@/lib/staticRebuild/types";
import {
  probePublicStaticTarget,
  type PublicStaticTargetProbe,
} from "./publicStaticTargetProbe";
import {
  rebuildStateFromEnqueue,
  resolvePublicDataState,
  type PublicDataState,
} from "./publicDataState";
import {
  isPublicEntityVisibilityBlocked,
  resolvePublicVisibilityGuardModeFromEnv,
} from "./publicVisibilityManifest";
import type { PublicVisibilityFenceEntityType } from "./publicVisibilityManifestCore";
import {
  applyEventSlotsOverride,
  eventBaseObjectKey,
  eventSlotsObjectKey,
  normalizeStaticEventDetail,
  type StaticEventDetail,
  type StaticEventDetailPayload,
  type StaticEventSlotsPayload,
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
  applyTopSlotStatsOverride,
  normalizeStaticTopSlotStats,
  TOP_SLOT_STATS_OBJECT_KEY,
} from "./staticTopSlotStatsCore";
import { loadStaticJsonFreshStaleUnavailable } from "./staticSharedInputsLoader";
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
  extractEventListInfo,
  isCompleteEventBasePool,
  pageEventBaseVideos,
} from "./staticEventListCore";
import {
  canFallbackToDatabase,
  isMaintenanceStrategy,
  shouldUseStaticCollection,
} from "./loaderPolicy";
import { canAttemptDegradedD1 } from "./degradedPolicy";
import {
  isDegradedD1CircuitOpen,
  recordDegradedCircuitR2Hit,
  recordDegradedCircuitR2Miss,
} from "./degradedCircuitBreaker";
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
  unwrapPublicJsonCachePayload,
  writePublicJsonCacheBestEffort,
} from "./publicCache";
import { PUBLIC_JSON_CACHE_TTL_SEC } from "./publicJsonCacheTtl";
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
export type { PublicDataState } from "./publicDataState";
export {
  shouldPublicPageNotFound,
  shouldPublicPageShowReflection,
  shouldPublicPageShowUnavailable,
} from "./publicDataState";
export {
  PublicDataUnavailableNotice,
  PublicReflectionPendingNotice,
} from "./publicPageNotices";
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
  /** R2 miss 時に enqueue する rebuild target（未指定時は targetType のみ） */
  missRebuildTargetTypes?: StaticRebuildTargetType[];
};

type ResolvePublicJsonMissOptions = {
  skipStaticMissRecord?: boolean;
};

export type PublicJsonLoadResult<T> = {
  data: T | null;
  mode: PublicDataMode;
  state: PublicDataState;
  rebuildState: RebuildRequestState;
  /** @deprecated Use `mode`. */
  source: "static" | "miss";
  strategy: PublicDataStrategy;
  enqueued: boolean;
  probe?: PublicStaticTargetProbe | null;
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

function mapTargetTypeToFenceEntity(
  targetType: StaticRebuildTargetType,
): PublicVisibilityFenceEntityType | null {
  if (targetType === "video") return "video";
  if (targetType === "event" || targetType === "event_base") return "event";
  if (targetType === "user") return "x_user";
  return null;
}

async function isLoaderTargetVisibilityBlocked(
  targetType: StaticRebuildTargetType,
  targetId: string,
): Promise<boolean> {
  const entityType = mapTargetTypeToFenceEntity(targetType);
  if (!entityType) return false;
  return isPublicEntityVisibilityBlocked({
    entityType,
    entityId: targetId,
    guardMode: resolvePublicVisibilityGuardModeFromEnv(),
  });
}

function buildStaticHitResult<T>(
  payload: T,
  mode: Extract<PublicDataMode, "static" | "cached_static">,
  strategy: PublicDataStrategy,
): PublicJsonLoadResult<T> {
  notePublicDataMode(mode);
  return {
    data: payload,
    mode,
    state: "ready",
    rebuildState: "not_needed",
    source: toPublicJsonLegacySource(mode),
    strategy,
    enqueued: false,
  };
}

function buildMissResult<T>(args: {
  data: T | null;
  mode: PublicDataMode;
  strategy: PublicDataStrategy;
  enqueued: boolean;
  probe?: PublicStaticTargetProbe | null;
  rebuildState?: RebuildRequestState;
  hasRenderableData?: boolean;
  isEmptyCollection?: boolean;
}): PublicJsonLoadResult<T> {
  if (args.mode === "degraded_d1") {
    notePublicDataMode("degraded_d1");
  } else if (args.mode === "unavailable") {
    notePublicDataMode("unavailable");
  }
  const state = resolvePublicDataState({
    hasRenderableData: args.hasRenderableData ?? args.data != null,
    isEmptyCollection: args.isEmptyCollection,
    probe: args.probe,
    enqueued: args.enqueued,
    mode: args.mode,
  });
  return {
    data: args.data,
    mode: args.mode,
    state,
    rebuildState: rebuildStateFromEnqueue({
      enqueued: args.enqueued,
      rebuildState: args.rebuildState,
    }),
    source: toPublicJsonLegacySource(args.mode),
    strategy: args.strategy,
    enqueued: args.enqueued,
    probe: args.probe,
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
    return buildMissResult<T>({
      data: null,
      mode: "unavailable",
      strategy,
      enqueued: false,
    });
  }

  let enqueued = false;
  let rebuildState: RebuildRequestState = "not_needed";
  let probe: PublicStaticTargetProbe | null = null;
  if (db) {
    try {
      probe = await probePublicStaticTarget(
        db,
        options.targetType,
        options.targetId,
      );
      recordPublicD1Query();
    } catch (error) {
      warnPublicStaticJson(options.targetType, "target_probe_failed", error);
      probe = {
        state: "unknown",
        errorCode:
          error instanceof Error ? error.name : "public_target_probe_failed",
      };
    }

    if (probe.state === "public") {
      const priority = resolvePublicMissEnqueuePriority(
        strategy,
        options.targetType,
      );
      const missTargets = options.missRebuildTargetTypes ?? [options.targetType];
      for (const missTargetType of missTargets) {
        const enqueueResult = await directEnqueueStaticRebuild(
          db,
          {
            targetType: missTargetType,
            targetId: options.targetId,
            reason: options.reason,
            priority,
          },
          { kind: "public_miss", cooldownSeconds: 300 },
        );
        recordPublicD1Query();
        rebuildState = enqueueResult.rebuildState;
        if (enqueueResult.ok) {
          enqueued =
            enqueued ||
            enqueueResult.action === "inserted" ||
            enqueueResult.action === "active_updated";
        } else {
          warnPublicStaticJson(
            options.r2Key,
            "enqueue_failed",
            new Error(enqueueResult.message),
          );
        }
      }
    }
  }

  if (options.degradedFetcher && canAttemptDegradedD1(strategy) && db) {
    if (!(await isDegradedD1CircuitOpen())) {
      try {
        const degraded = await options.degradedFetcher();
        if (degraded != null) {
          return buildMissResult({
            data: degraded,
            mode: "degraded_d1",
            strategy,
            enqueued,
            probe,
            rebuildState,
            hasRenderableData: true,
          });
        }
      } catch (error) {
        warnPublicStaticJson(options.r2Key, "read_failed", error);
      }
    }
  }

  return buildMissResult<T>({
    data: null,
    mode: "unavailable",
    strategy,
    enqueued,
    probe,
    rebuildState,
  });
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
  const operationMode = await resolvePublicOperationMode({ allowD1: true });
  const maintenanceStrategy = getPublicDataStrategy(operationMode);
  if (maintenanceStrategy === "maintenance") {
    return buildMissResult<T>({
      data: null,
      mode: "unavailable",
      strategy: maintenanceStrategy,
      enqueued: false,
    });
  }

  if (await isLoaderTargetVisibilityBlocked(options.targetType, options.targetId)) {
    return buildMissResult<T>({
      data: null,
      mode: "unavailable",
      strategy: maintenanceStrategy,
      enqueued: false,
      probe: { state: "not_public", canonicalTargetId: options.targetId },
    });
  }

  const cached = unwrapPublicJsonCachePayload<T>(
    await readPublicJsonCache<unknown>(options.r2Key),
  );
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
    void recordDegradedCircuitR2Hit();
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

  void recordDegradedCircuitR2Miss();
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


export async function loadStaticEventDetail(
  eventId: string,
): Promise<PublicJsonLoadResult<StaticEventDetail>> {
  const options: PublicJsonLoadOptions<StaticEventDetailPayload> = {
    r2Key: `events/${eventId}.json`,
    targetType: "event",
    targetId: eventId,
    reason: "public_event_detail_miss",
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.eventDetail,
    missRebuildTargetTypes: ["event_base", "event_slots"],
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedEventDetailPayload(db, eventId);
    },
  };
  const result = await loadPublicJson<StaticEventDetailPayload>(options);
  if (result.data == null) {
    return { ...result, data: null };
  }
  const normalized = normalizeStaticEventDetail(result.data);
  if (normalized == null) {
    return resolvePublicJsonMiss<StaticEventDetail>(
      options as unknown as PublicJsonLoadOptions<StaticEventDetail>,
      { skipStaticMissRecord: true },
    );
  }
  const slotsResult = await loadStaticJsonFreshStaleUnavailable<StaticEventSlotsPayload>({
    key: eventSlotsObjectKey(eventId),
    normalize: (value) =>
      value && typeof value === "object" ? (value as StaticEventSlotsPayload) : null,
    maxStaleAgeSec: PUBLIC_JSON_CACHE_TTL_SEC.eventDetail * 2,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.eventDetail,
  });
  const detail = applyEventSlotsOverride(normalized, slotsResult.value);
  return { ...result, data: detail };
}

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
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.eventsIndex,
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
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.listRecent,
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
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.listPopular,
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
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.searchIndex,
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
  const eventId = params.eventId.trim();
  const unavailable = (
    strategy: PublicDataStrategy,
    extra?: Partial<PublicJsonLoadResult<StaticRecentVideoPage>>,
  ) => ({
    ...buildMissResult({
      data: null,
      mode: "unavailable",
      strategy,
      enqueued: false,
    }),
    page: null,
    eventInfo: null,
    ...extra,
  });

  if (!eventId) {
    const strategy = getPublicDataStrategy(
      await resolvePublicOperationMode({ allowD1: true }),
    );
    return unavailable(strategy);
  }

  const maintenanceMode = await resolvePublicOperationMode({ allowD1: true });
  const maintenanceStrategy = getPublicDataStrategy(maintenanceMode);
  if (maintenanceStrategy === "maintenance") {
    return unavailable(maintenanceStrategy);
  }

  if (await isLoaderTargetVisibilityBlocked("event_base", eventId)) {
    return unavailable(maintenanceStrategy, {
      probe: { state: "not_public", canonicalTargetId: eventId },
    });
  }

  const r2Key = eventBaseObjectKey(eventId);
  const missOptions: PublicJsonLoadOptions<StaticEventDetailPayload> = {
    r2Key,
    targetType: "event_base",
    targetId: eventId,
    reason: "public_event_list_miss",
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.eventDetail,
    missRebuildTargetTypes: ["event_base", "event_slots"],
  };

  const tryStaticEventList = (
    payload: StaticEventDetailPayload,
    mode: Extract<PublicDataMode, "static" | "cached_static">,
    strategy: PublicDataStrategy,
  ) => {
    if (!isCompleteEventBasePool(payload)) return null;
    const eventInfo = extractEventListInfo(payload);
    const page = pageEventBaseVideos({
      payload,
      sort: params.sort,
      page: params.page,
      pageSize: params.pageSize,
      q: params.q,
      eventTitle: eventInfo?.title,
    });
    if (!eventInfo || !page) return null;
    return {
      ...buildStaticHitResult(page, mode, strategy),
      page,
      eventInfo,
    };
  };

  const cached = unwrapPublicJsonCachePayload<StaticEventDetailPayload>(
    await readPublicJsonCache<unknown>(r2Key),
  );
  if (cached !== null) {
    const strategy = getPublicDataStrategy(
      await resolvePublicOperationMode({ allowD1: false }),
    );
    const hit = tryStaticEventList(cached, "cached_static", strategy);
    if (hit) {
      recordPublicStaticHit();
      return hit;
    }
  }

  const payload = await readStaticJson<StaticEventDetailPayload>(r2Key);
  let missMeta: Pick<
    PublicJsonLoadResult<StaticRecentVideoPage>,
    "enqueued" | "rebuildState" | "probe"
  > = {
    enqueued: false,
    rebuildState: "not_needed",
    probe: undefined,
  };

  if (payload !== null) {
    void recordDegradedCircuitR2Hit();
    const strategy = getPublicDataStrategy(
      await resolvePublicOperationMode({ allowD1: false }),
    );
    writePublicJsonCacheBestEffort(
      r2Key,
      payload,
      PUBLIC_JSON_CACHE_TTL_SEC.eventDetail,
    );
    const hit = tryStaticEventList(payload, "static", strategy);
    if (hit) {
      recordPublicStaticHit();
      return hit;
    }
  } else {
    void recordDegradedCircuitR2Miss();
    const miss = await resolvePublicJsonMiss(missOptions);
    missMeta = {
      enqueued: miss.enqueued,
      rebuildState: miss.rebuildState,
      probe: miss.probe,
    };
  }

  const db = getDatabase();
  const strategy = getPublicDataStrategy(
    await resolvePublicOperationMode({ allowD1: true, db }),
  );

  if (!canAttemptDegradedD1(strategy) || !db) {
    return unavailable(strategy, missMeta);
  }

  if (await isDegradedD1CircuitOpen()) {
    return unavailable(strategy, missMeta);
  }

  try {
    const degraded = await fetchDegradedEventListPage(db, {
      ...params,
      eventId,
    });
    if (!degraded) {
      return unavailable(strategy, missMeta);
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
      part: item.part ?? null,
    }));
    const page: StaticRecentVideoPage = {
      videos,
      total: degraded.total,
      generatedAt: null,
    };
    return {
      ...buildMissResult({
        data: page,
        mode: "degraded_d1",
        strategy,
        enqueued: missMeta.enqueued,
        probe: missMeta.probe,
        rebuildState: missMeta.rebuildState,
        hasRenderableData: true,
      }),
      page,
      eventInfo: degraded.eventInfo,
    };
  } catch (error) {
    warnPublicStaticJson(`list/event/${eventId}`, "read_failed", error);
    return unavailable(strategy, missMeta);
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
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.rules,
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
    missRebuildTargetTypes: [
      "top_recommended",
      "top_latest",
      "top_nostalgic",
      "top_stats",
      "recommend_core",
    ],
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.top,
    isEmptyCollection: isEmptyTopCollection,
    degradedFetcher: async () => {
      const db = getDatabase();
      if (!db) return null;
      return fetchDegradedTopPayload(db);
    },
  });
  const normalized = result.data ? normalizeStaticTop(result.data) : null;
  const slotStatsResult = await loadStaticJsonFreshStaleUnavailable({
    key: TOP_SLOT_STATS_OBJECT_KEY,
    normalize: normalizeStaticTopSlotStats,
    maxStaleAgeSec: PUBLIC_JSON_CACHE_TTL_SEC.topSlotStats * 2,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.topSlotStats,
  });
  const slotStatsArtifact = slotStatsResult.value;
  const normalizedWithSlotStats =
    normalized ? applyTopSlotStatsOverride(normalized, slotStatsArtifact) : null;
  const top =
    normalizedWithSlotStats &&
    (result.mode === "degraded_d1" ||
      shouldUseStaticCollection(result.strategy, countStaticTopItems(normalizedWithSlotStats)))
      ? normalizedWithSlotStats
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
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
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
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.recommend,
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
  cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.userDetail,
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
      ...buildStaticHitResult(
        normalized,
        "static",
        params.strategy ?? "static_json_only",
      ),
      page: normalized,
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
      ...buildStaticHitResult(
        normalized,
        "static",
        params.strategy ?? "static_json_only",
      ),
      page: normalized,
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
  cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.videoDetail,
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
