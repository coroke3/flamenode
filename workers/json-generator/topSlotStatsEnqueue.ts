import { TOP_SLOT_STATS_OBJECT_KEY } from "../../src/lib/publicData/staticTopSlotStatsCore.ts";
import { enqueueStaticRebuildTargets, globalTargets } from "./staticRebuildEnqueue.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const TOP_SLOT_STATS_REPAIR_MAX_D1_STATEMENTS = 1;

export async function enqueueTopSlotStatsRebuild(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<number> {
  return enqueueStaticRebuildTargets(
    env,
    globalTargets(["top_slot_stats"]),
    reason,
    priority,
    signal,
  );
}

/** R2上の top slot-stats artifact が欠けていれば top_slot_stats:global を enqueue する。 */
export async function ensureTopSlotStatsOnR2(
  env: EnqueueEnv,
  options: {
    reason: string;
    priority: "high" | "low";
    signal?: AbortSignal;
  },
): Promise<number> {
  options.signal?.throwIfAborted();
  const head = await env.R2.head(TOP_SLOT_STATS_OBJECT_KEY);
  if (head) {
    return 0;
  }
  return enqueueTopSlotStatsRebuild(
    env,
    options.reason,
    options.priority,
    options.signal,
  );
}
