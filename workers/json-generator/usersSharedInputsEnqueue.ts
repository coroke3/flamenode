import {
  PICKUP_CREATORS_OBJECT_KEY,
  USERS_INDEX_OBJECT_KEY,
} from "../../src/lib/publicData/publicCreatorProjection.ts";
import { PUBLIC_X_ICON_MAP_OBJECT_KEY } from "../../src/lib/publicData/publicIconProjection.ts";
import { enqueueStaticRebuildTargets, globalTargets } from "./staticRebuildEnqueue.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const USERS_SHARED_REPAIR_MAX_D1_STATEMENTS = 1;

export async function enqueueUsersIndexRebuild(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<number> {
  return enqueueStaticRebuildTargets(
    env,
    globalTargets(["users_index"]),
    reason,
    priority,
    signal,
  );
}

/** R2上の users 正本共有JSONが欠けていれば users_index:global を enqueue する。v2 manifestは任意の高速化成果物なので必須判定に含めない。 */
export async function ensureUsersSharedInputsOnR2(
  env: EnqueueEnv,
  options: {
    reason: string;
    priority: "high" | "low";
    signal?: AbortSignal;
  },
): Promise<number> {
  options.signal?.throwIfAborted();
  const [indexHead, iconMapHead, pickupHead] = await Promise.all([
    env.R2.head(USERS_INDEX_OBJECT_KEY),
    env.R2.head(PUBLIC_X_ICON_MAP_OBJECT_KEY),
    env.R2.head(PICKUP_CREATORS_OBJECT_KEY),
  ]);
  if (indexHead && iconMapHead && pickupHead) {
    return 0;
  }
  return enqueueUsersIndexRebuild(
    env,
    options.reason,
    options.priority,
    options.signal,
  );
}
