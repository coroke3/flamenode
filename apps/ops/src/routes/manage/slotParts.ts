/**
 * MIG-0722 U02a: pure slot grouping, ported from CURRENT
 * src/lib/utils/slotGroupingCore.ts (buildSlotParts / areSlotsInSamePart).
 * Preserve JST day transitions, chronological sort, and untimed consecutive
 * sort_order grouping without importing Next-only aliases into Ops.
 */
import type { ManageSlotRow } from "@flamenode/contracts";

const JST_OFFSET_SECONDS = 9 * 60 * 60;
export type DisplaySlotPart = {
  index: number;
  isTimeless: boolean;
  rows: ManageSlotRow[];
};

export function groupDisplaySlots(slots: readonly ManageSlotRow[], rawGapMinutes: number | null): DisplaySlotPart[] {
  const gapSeconds = rawGapMinutes !== null && Number.isFinite(rawGapMinutes) &&
    rawGapMinutes >= 0 ? rawGapMinutes * 60 : 15 * 60;
  const sorted = [...slots].sort((a, b) => {
    if ((a.start_time === null) !== (b.start_time === null)) {
      return a.start_time === null ? 1 : -1;
    }
    const byTime = (a.start_time ?? 0) - (b.start_time ?? 0);
    if (byTime !== 0) return byTime;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id);
  });
  const parts: DisplaySlotPart[] = [];
  for (const slot of sorted) {
    const previous = parts.at(-1)?.rows.at(-1);
    const contiguous = previous != null && (
      previous.start_time !== null && slot.start_time !== null
        ? slot.start_time >= previous.start_time &&
          Math.floor((slot.start_time + JST_OFFSET_SECONDS) / 86400) ===
            Math.floor((previous.start_time + JST_OFFSET_SECONDS) / 86400) &&
          slot.start_time - previous.start_time <= gapSeconds
        : previous.start_time === null && slot.start_time === null &&
          previous.sort_order !== null && slot.sort_order === previous.sort_order + 1
    );
    if (!contiguous) {
      parts.push({ index: parts.length + 1, isTimeless: slot.start_time === null, rows: [] });
    }
    parts.at(-1)!.rows.push(slot);
  }
  return parts;
}

export function partLabels(slots: readonly ManageSlotRow[], gapMinutes: number | null,
  configuredParts: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const part of groupDisplaySlots(slots, gapMinutes)) {
    const label = part.isTimeless
      ? "件数枠"
      : configuredParts[part.index - 1]?.trim() || `第${part.index}部`;
    for (const slot of part.rows) labels.set(slot.id, label);
  }
  return labels;
}
