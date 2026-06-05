import type { StaticRebuildPriority } from "./types";

const RANK: Record<StaticRebuildPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export function pickHigherPriority(
  a: StaticRebuildPriority,
  b: StaticRebuildPriority,
): StaticRebuildPriority {
  return RANK[a] <= RANK[b] ? a : b;
}
