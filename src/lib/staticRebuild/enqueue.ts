// Compatibility bridge (MIG-0614, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import type { DB } from "@/lib/db/client";
import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import {
  enqueueStaticRebuild as enqueueStaticRebuildCore,
  enqueueStaticRebuildMany as enqueueStaticRebuildManyCore,
  type EnqueueStaticRebuildOptions,
} from "@flamenode/server-core/staticRebuild/enqueue";
import type { EnqueueStaticRebuildInput } from "@flamenode/server-core/staticRebuild/types";

export * from "@flamenode/server-core/staticRebuild/enqueue";
export { directEnqueueStaticRebuild } from "./directEnqueue";

const loadNextQueueWakeHost = async () => nextQueueWakeHost;

export function enqueueStaticRebuild(
  db: DB,
  input: EnqueueStaticRebuildInput,
  options?: EnqueueStaticRebuildOptions,
): Promise<void> {
  return enqueueStaticRebuildCore(db, input, options, loadNextQueueWakeHost);
}

export function enqueueStaticRebuildMany(
  db: DB,
  items: EnqueueStaticRebuildInput[],
  options?: EnqueueStaticRebuildOptions,
): Promise<void> {
  return enqueueStaticRebuildManyCore(db, items, options, loadNextQueueWakeHost);
}
