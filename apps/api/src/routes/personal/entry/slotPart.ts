// CURRENT: src/lib/video/slotPart.ts (resolvePartFromSlot), src/lib/video/parseEventIds.ts (parseEventPartsJson),
// src/lib/utils/slotGroupingCore.ts (buildSlotParts and its helpers). Copied pure functions; parity-tested against
// the real modules. The caller supplies the event's slots (id, start_time, sort_order) already read.

export interface PartSlot {
  id: string;
  start_time: number | null;
  sort_order: number | null;
}

const JST_OFFSET_SEC = 9 * 60 * 60;

function jstDayBucket(unixSec: number | null): number | null {
  return unixSec == null || !Number.isFinite(unixSec) ? null : Math.floor((unixSec + JST_OFFSET_SEC) / (24 * 60 * 60));
}

function normalizeGapSec(gapSec: number): number {
  return Number.isFinite(gapSec) && gapSec >= 0 ? gapSec : 15 * 60;
}

function sortSlotsChronologically(rows: readonly PartSlot[]): PartSlot[] {
  return [...rows].sort((a, b) => {
    const aTimed = a.start_time != null;
    const bTimed = b.start_time != null;
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    const startDiff = (a.start_time ?? 0) - (b.start_time ?? 0);
    if (startDiff !== 0) return startDiff;
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    return orderDiff || (a.id ?? "").localeCompare(b.id ?? "");
  });
}

function areSlotsInSamePart(prev: PartSlot, next: PartSlot, gapSec: number): boolean {
  if (prev.start_time != null && next.start_time != null) {
    if (next.start_time < prev.start_time) return false;
    if (jstDayBucket(prev.start_time) !== jstDayBucket(next.start_time)) return false;
    return next.start_time - prev.start_time <= normalizeGapSec(gapSec);
  }
  if (prev.start_time == null && next.start_time == null) {
    return prev.sort_order != null && next.sort_order != null && next.sort_order === prev.sort_order + 1;
  }
  return false;
}

/** CURRENT buildSlotParts: groups the slots into parts; returns the part rows' ids in order. */
function buildSlotPartIds(rows: readonly PartSlot[], gapSec: number): string[][] {
  if (rows.length === 0) return [];
  const parts: string[][] = [];
  let current: PartSlot[] = [];
  for (const row of sortSlotsChronologically(rows)) {
    const previous = current.at(-1);
    if (previous && !areSlotsInSamePart(previous, row, gapSec)) {
      parts.push(current.map((r) => r.id));
      current = [];
    }
    current.push(row);
  }
  if (current.length > 0) parts.push(current.map((r) => r.id));
  return parts;
}

export function parseEventPartsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** CURRENT resolvePartFromSlot with the event row and its slots supplied. */
export function resolvePartFromSlotRows(input: {
  slotId: string;
  partsJson: string | null;
  slotPartGapMinutes: number | null;
  eventSlots: readonly PartSlot[];
}): string | null {
  const configuredParts = parseEventPartsJson(input.partsJson);
  if (configuredParts.length === 0) return null;
  const parts = buildSlotPartIds(input.eventSlots, (input.slotPartGapMinutes ?? 15) * 60);
  const index = parts.findIndex((ids) => ids.includes(input.slotId));
  return index >= 0 ? (configuredParts[index] ?? null) : null;
}
