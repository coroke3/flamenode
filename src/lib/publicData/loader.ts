import "server-only";

import { getDatabase, getEnv } from "@/lib/cloudflare";
import { getOperationMode } from "@/lib/operationMode/getMode";
import { getPublicDataStrategy } from "@/lib/operationMode/policy";
import type { PublicDataStrategy } from "@/lib/operationMode/types";
import { enqueueStaticRebuild } from "@/lib/staticRebuild/enqueue";
import type { StaticRebuildTargetType } from "@/lib/staticRebuild/types";
import {
  canFallbackToDatabase,
  isMaintenanceStrategy,
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

async function readStaticJson<T>(key: string): Promise<T | null> {
  const bucket = getEnv().BUCKET;
  if (!bucket) return null;
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return (await object.json()) as T;
  } catch {
    console.warn(
      JSON.stringify({
        service: "public-static-json",
        object_key: key.slice(0, 240),
        result: "invalid_json",
      }),
    );
    return null;
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
  if (payload) {
    return { data: payload, source: "static", strategy, enqueued: false };
  }

  let enqueued = false;
  if (db) {
    const priority = strategy === "static_json_only" ? "high" : "normal";
    await enqueueStaticRebuild(db, {
      targetType: options.targetType,
      targetId: options.targetId,
      reason: options.reason,
      priority,
    });
    enqueued = true;
  }

  return { data: null, source: "miss", strategy, enqueued };
}
