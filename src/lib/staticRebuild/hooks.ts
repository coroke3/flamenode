// Compatibility bridge (MIG-0614, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import type { DB } from "@/lib/db/client";
import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import {
  enqueueAfterVideoCreate as enqueueAfterVideoCreateCore,
  enqueueAfterVideoUpdate as enqueueAfterVideoUpdateCore,
  enqueueAfterXUserPublicUpdate as enqueueAfterXUserPublicUpdateCore,
} from "@flamenode/server-core/staticRebuild/hooks";

export * from "@flamenode/server-core/staticRebuild/hooks";

const loadNextQueueWakeHost = async () => nextQueueWakeHost;

export function enqueueAfterVideoCreate(
  db: DB,
  opts: Parameters<typeof enqueueAfterVideoCreateCore>[1],
): Promise<void> {
  return enqueueAfterVideoCreateCore(db, opts, loadNextQueueWakeHost);
}

export function enqueueAfterVideoUpdate(
  db: DB,
  opts: Parameters<typeof enqueueAfterVideoUpdateCore>[1],
): Promise<void> {
  return enqueueAfterVideoUpdateCore(db, opts, loadNextQueueWakeHost);
}

export function enqueueAfterXUserPublicUpdate(
  db: DB,
  opts: Parameters<typeof enqueueAfterXUserPublicUpdateCore>[1],
): Promise<void> {
  return enqueueAfterXUserPublicUpdateCore(db, opts, loadNextQueueWakeHost);
}
