/** CURRENT-compatible slot ordering and part boundaries for server-core consumers. */
export type SlotPart<T extends { start_time: number | null }> = {
  index: number;
  rows: T[];
  start_time: number | null;
  last_start_time: number | null;
  is_timeless: boolean;
};

const JST_OFFSET_SEC = 9 * 60 * 60;

function jstDayBucket(unixSec: number | null): number | null {
  return unixSec == null || !Number.isFinite(unixSec)
    ? null
    : Math.floor((unixSec + JST_OFFSET_SEC) / (24 * 60 * 60));
}

function normalizeGapSec(gapSec: number): number {
  return Number.isFinite(gapSec) && gapSec >= 0 ? gapSec : 15 * 60;
}

// Treat malformed provider timestamps as untimed without mutating source rows.
function finiteStartTime(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function sortSlotsChronologically<
  T extends {
    id?: string | null;
    start_time: number | null;
    sort_order?: number | null;
  },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    // Malformed timestamps must not bypass the order/id tie-breaker via NaN.
    const aStart = finiteStartTime(a.start_time);
    const bStart = finiteStartTime(b.start_time);
    const aTimed = aStart !== null;
    const bTimed = bStart !== null;
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    const startDiff = (aStart ?? 0) - (bStart ?? 0);
    if (startDiff !== 0) return startDiff;
    const aOrder = a.sort_order != null && Number.isSafeInteger(a.sort_order)
      ? a.sort_order
      : 0;
    const bOrder = b.sort_order != null && Number.isSafeInteger(b.sort_order)
      ? b.sort_order
      : 0;
    const orderDiff = aOrder - bOrder;
    return orderDiff || (a.id ?? "").localeCompare(b.id ?? "");
  });
}

export function areSlotsInSamePart<
  T extends { start_time: number | null; sort_order?: number | null },
>(prev: T, next: T, gapSec = 15 * 60): boolean {
  if (prev.start_time != null && next.start_time != null) {
    if (next.start_time < prev.start_time) return false;
    if (jstDayBucket(prev.start_time) !== jstDayBucket(next.start_time)) return false;
    return next.start_time - prev.start_time <= normalizeGapSec(gapSec);
  }
  if (prev.start_time == null && next.start_time == null) {
    return (
      prev.sort_order != null &&
      next.sort_order != null &&
      Number.isSafeInteger(prev.sort_order) &&
      Number.isSafeInteger(next.sort_order) &&
      next.sort_order === prev.sort_order + 1
    );
  }
  return false;
}

export function buildSlotParts<
  T extends { start_time: number | null; sort_order?: number | null },
>(rows: T[], gapSec = 15 * 60): SlotPart<T>[] {
  if (rows.length === 0) return [];
  const ordered = sortSlotsChronologically(rows);
  const parts: SlotPart<T>[] = [];
  let current: T[] = [];
  for (const row of ordered) {
    const previous = current.at(-1);
    if (previous && !areSlotsInSamePart(previous, row, gapSec)) {
      parts.push({
        index: parts.length + 1,
        rows: current,
        start_time: finiteStartTime(current[0]?.start_time),
        last_start_time: finiteStartTime(current.at(-1)?.start_time),
        is_timeless: finiteStartTime(current[0]?.start_time) === null,
      });
      current = [];
    }
    current.push(row);
  }
  if (current.length > 0) {
    parts.push({
      index: parts.length + 1,
      rows: current,
      start_time: finiteStartTime(current[0]?.start_time),
      last_start_time: finiteStartTime(current.at(-1)?.start_time),
      is_timeless: finiteStartTime(current[0]?.start_time) === null,
    });
  }
  return parts;
}
