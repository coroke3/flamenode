import "server-only";

import { eq } from "drizzle-orm";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import { getPublicDataStrategy } from "@/lib/operationMode/policy";
import { resolveOperationMode } from "@/lib/operationMode/resolve";
import type {
  OperationMode,
  PublicDataStrategy,
} from "@/lib/operationMode/types";
import { enqueueStaticRebuild } from "@/lib/staticRebuild/enqueue";
import type { StaticRebuildTargetType } from "@/lib/staticRebuild/types";
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
  normalizeStaticRecentVideoPage,
  type StaticRecentVideoPage,
  type StaticRecentVideosPayload,
} from "./staticRecentVideoCore";
import {
  normalizeStaticTop,
  type StaticTopData,
  type StaticTopPayload,
} from "./staticTopCore";
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
} from "./loaderPolicy";

async function getOperationMode(db: DB): Promise<OperationMode> {
  try {
    const row = await db
      .select({ operation_mode: systemSettings.operation_mode })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1);
    return resolveOperationMode(row[0]);
  } catch {
    return "normal";
  }
}

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
  result: "invalid_json" | "read_failed" | "enqueue_failed",
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
  const db = getDatabase();
  const mode = db ? await getOperationMode(db) : "normal";
  const strategy = getPublicDataStrategy(mode);

  if (strategy === "maintenance") {
    return { data: null, source: "miss", strategy, enqueued: false };
  }

  const payload = await readStaticJson<T>(options.r2Key);
  if (payload !== null) {
    return { data: payload, source: "static", strategy, enqueued: false };
  }

  let enqueued = false;
  if (db) {
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
  const page = result.data
    ? normalizeStaticRecentVideoPage(result.data, params.page, params.pageSize)
    : null;
  return { ...result, data: page, page };
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
export type { StaticTopData } from "./staticTopCore";
export type { StaticUserProfile } from "./staticUserProfileCore";
export type { StaticVideoDetail } from "./staticVideoDetailCore";
