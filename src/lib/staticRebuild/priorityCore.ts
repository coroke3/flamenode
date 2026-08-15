import type { StaticRebuildPriority } from "./types";

export const PRIORITY_ORDER: Record<StaticRebuildPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export const PRIORITY_RANK: Record<StaticRebuildPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

export function pickHigherPriority(
  a: StaticRebuildPriority,
  b: StaticRebuildPriority,
): StaticRebuildPriority {
  return PRIORITY_ORDER[a] <= PRIORITY_ORDER[b] ? a : b;
}

export function shouldUseIncomingQueueMetadata(
  existingPriority: StaticRebuildPriority,
  incomingPriority: StaticRebuildPriority,
): boolean {
  return PRIORITY_RANK[incomingPriority] >= PRIORITY_RANK[existingPriority];
}

/**
 * Keep the visibility-republish reason until the worker has rebuilt the
 * public artifact and released its matching fence. Other enqueues may still
 * raise priority and refresh the requester metadata.
 */
export function resolveQueueReason(
  existingReason: string | null | undefined,
  incomingReason: string,
  existingPriority: StaticRebuildPriority,
  incomingPriority: StaticRebuildPriority,
): string {
  if (isSafetyQueueReason(incomingReason)) {
    return incomingReason;
  }
  if (isSafetyQueueReason(existingReason)) {
    return existingReason ?? incomingReason;
  }
  return shouldUseIncomingQueueMetadata(existingPriority, incomingPriority)
    ? incomingReason
    : existingReason ?? incomingReason;
}

/** Reasons whose follow-up must not be replaced before the worker runs. */
export function isSafetyQueueReason(
  reason: string | null | undefined,
): boolean {
  return (
    reason === "video_visibility_update" ||
    reason === "event_id_rename_old_cleanup"
  );
}
