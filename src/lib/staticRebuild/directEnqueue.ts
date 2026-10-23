// Compatibility bridge (MIG-0614, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import type { DB } from "@/lib/db/client";
import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import {
  directEnqueueStaticRebuild as directEnqueueStaticRebuildCore,
  type DirectEnqueueStaticRebuildOptions,
} from "@flamenode/server-core/staticRebuild/directEnqueue";
import type {
  DirectEnqueueCause,
  DirectEnqueueResult,
  EnqueueStaticRebuildInput,
} from "@flamenode/server-core/staticRebuild/types";

export * from "@flamenode/server-core/staticRebuild/directEnqueue";

const loadNextQueueWakeHost = async () => nextQueueWakeHost;

export function directEnqueueStaticRebuild(
  db: DB,
  input: EnqueueStaticRebuildInput,
  cause: DirectEnqueueCause,
  options?: DirectEnqueueStaticRebuildOptions,
): Promise<DirectEnqueueResult> {
  return directEnqueueStaticRebuildCore(db, input, cause, options, loadNextQueueWakeHost);
}
