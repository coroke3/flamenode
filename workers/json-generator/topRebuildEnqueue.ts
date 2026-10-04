import {
  enqueueStaticRebuildTargets,
  globalTargets,
  type StaticRebuildEnqueuePriority,
} from "./staticRebuildEnqueue.ts";

type EnqueueEnv = { DB: D1Database };

export async function enqueueTopSectionRebuild(
  env: EnqueueEnv,
  targetType: string,
  reason: string,
  priority: StaticRebuildEnqueuePriority,
  signal?: AbortSignal,
): Promise<number> {
  return enqueueStaticRebuildTargets(
    env,
    globalTargets([targetType]),
    reason,
    priority,
    signal,
  );
}
