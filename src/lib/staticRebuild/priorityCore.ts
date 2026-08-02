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
