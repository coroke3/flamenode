import {
  areSlotsInSamePart,
  sortSlotsChronologically,
} from "../utils/slotGroupingCore.ts";

type ContiguousSlot = {
  id: string;
  status: string;
  start_time: number | null;
  sort_order?: number | null;
};

export function countContiguousAvailableForward(args: {
  slots: ContiguousSlot[];
  anchorId: string;
  eventMax: number;
  gapSec: number;
}): number {
  const { slots, anchorId, eventMax, gapSec } = args;
  const ordered = sortSlotsChronologically(slots);
  const anchorIndex = ordered.findIndex((slot) => slot.id === anchorId);
  if (anchorIndex < 0) return 0;

  const anchor = ordered[anchorIndex];
  if (anchor.status !== "available") return 0;

  let count = 1;
  for (let i = anchorIndex + 1; i < ordered.length && count < eventMax; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (current.status !== "available") break;
    if (!areSlotsInSamePart(previous, current, gapSec)) break;
    count++;
  }
  return Math.min(eventMax, count);
}
