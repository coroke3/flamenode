// Compatibility bridge (MIG-0618, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import type { DB } from "@/lib/db/client";
import {
  captureXIdMergeRestoreSnapshot as captureXIdMergeRestoreSnapshotCore,
  executeApprovedXIdMergeRequest as executeApprovedXIdMergeRequestCore,
  restoreApprovedXIdMergeRevertRequest as restoreApprovedXIdMergeRevertRequestCore,
  type XIdMergeHost,
} from "@flamenode/server-core/xid/merge";
import type {
  MergeRequestRow,
  XIdMergeExecutionResult,
  XIdMergeRestoreSnapshot,
} from "@flamenode/server-core/xid/mergeCore";
import { xUserVisibilityHost } from "./xUserVisibilityTransition";

export { planXIdMergeD1Budget } from "./mergeBudget";
export {
  X_ID_MERGE_CALLER_D1_QUERY_COUNT,
  X_ID_MERGE_REVERT_WINDOW_SECONDS,
  X_ID_MERGE_SNAPSHOT_MAX_BYTES,
  X_ID_MERGE_SNAPSHOT_MAX_ROWS_PER_RELATION,
  X_ID_MERGE_SNAPSHOT_MAX_TOTAL_ROWS,
  X_ID_MERGE_STATIC_REBUILD_TARGET_LIMIT,
  X_ID_REVERT_CALLER_D1_QUERY_COUNT,
  type XIdMergeExecutionResult,
  type XIdMergeRestoreSnapshot,
} from "@flamenode/server-core/xid/mergeCore";

/** Same lazy loader as the audit/mutate bridge: nextPorts.ts is only evaluated when a Queue wake is sent. */
const xIdMergeHost: XIdMergeHost = {
  visibility: xUserVisibilityHost,
  loadQueueWakeHost: async () =>
    (await import("@/lib/serverCore/nextPorts")).nextQueueWakeHost,
};

export function captureXIdMergeRestoreSnapshot(
  db: DB,
  sourceXUserId: string,
  targetXUserId: string,
): Promise<XIdMergeRestoreSnapshot> {
  return captureXIdMergeRestoreSnapshotCore(db, sourceXUserId, targetXUserId);
}

export function executeApprovedXIdMergeRequest(
  db: DB,
  input: {
    request: MergeRequestRow;
    actorAuthUserId: string;
  },
): Promise<XIdMergeExecutionResult> {
  return executeApprovedXIdMergeRequestCore(db, input, xIdMergeHost);
}

export function restoreApprovedXIdMergeRevertRequest(
  db: DB,
  input: {
    request: MergeRequestRow;
    parentRequest: MergeRequestRow;
    actorAuthUserId: string;
  },
): Promise<Record<string, number>> {
  return restoreApprovedXIdMergeRevertRequestCore(db, input, xIdMergeHost);
}
