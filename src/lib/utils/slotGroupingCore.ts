/**
 * slotGrouping の純粋ロジック (formatUnix などの I/O 依存を含まない部分)。
 * テスト容易性のため slotGrouping.ts から切り出している。
 */

export type SlotBase = {
  id: string;
  event_id: string;
  slot_kind: "time" | "count" | null;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  discord_user_id: string | null;
  reservation_group_id: string | null;
  video_id: string | null;
  updated_at: number;
  priority_reclaim_video_id: string | null;
  priority_reclaim_until: number | null;
  event_title?: string | null;
};

export type SlotPart<T extends { start_time: number | null }> = {
  index: number;
  rows: T[];
  start_time: number | null;
  last_start_time: number | null;
  is_timeless: boolean;
};

export type SlotGroupRow = SlotBase & {
  slot_ids: string[];
  group_id: string | null;
  group_size: number;
  is_group: boolean;
};

function withoutDeprecatedEndTime(row: SlotBase): SlotBase {
  const { end_time: _deprecatedEndTime, ...rest } = row as SlotBase & {
    end_time?: unknown;
  };
  return rest;
}

const JST_OFFSET_SEC = 9 * 60 * 60;

function jstDayBucket(unixSec: number | null): number | null {
  if (unixSec == null || !Number.isFinite(unixSec)) return null;
  return Math.floor((unixSec + JST_OFFSET_SEC) / (24 * 60 * 60));
}

function normalizeGapSec(gapSec: number): number {
  return Number.isFinite(gapSec) && gapSec >= 0 ? gapSec : 15 * 60;
}

export function sortSlotsChronologically<
  T extends {
    id?: string | null;
    start_time: number | null;
    sort_order?: number | null;
  },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aTimed = a.start_time != null;
    const bTimed = b.start_time != null;
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    const aStart = a.start_time ?? 0;
    const bStart = b.start_time ?? 0;
    if (aStart !== bStart) return aStart - bStart;
    const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (sortDiff !== 0) return sortDiff;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}

export function areSlotsInSamePart<
  T extends {
    start_time: number | null;
    sort_order?: number | null;
    slot_kind?: string | null;
  },
>(prev: T, next: T, gapSec = 15 * 60): boolean {
  if ((prev.slot_kind ?? null) !== (next.slot_kind ?? null)) return false;

  const prevStart = prev.start_time;
  const nextStart = next.start_time;
  if (prevStart != null && nextStart != null) {
    if (nextStart < prevStart) return false;
    if (jstDayBucket(prevStart) !== jstDayBucket(nextStart)) return false;
    return nextStart - prevStart <= normalizeGapSec(gapSec);
  }

  if (prevStart == null && nextStart == null) {
    const prevOrder = prev.sort_order;
    const nextOrder = next.sort_order;
    if (prevOrder == null || nextOrder == null) return false;
    return nextOrder === prevOrder + 1;
  }

  return false;
}

export function buildSlotParts<
  T extends {
    start_time: number | null;
    slot_kind?: string | null;
  },
>(rows: T[], gapSec = 15 * 60): SlotPart<T>[] {
  if (rows.length === 0) return [];
  const timed = sortSlotsChronologically(rows.filter((r) => r.start_time != null));
  const timeless = rows.filter((r) => r.start_time == null);
  const effectiveGapSec = normalizeGapSec(gapSec);
  const parts: SlotPart<T>[] = [];
  let current: T[] = [];
  for (const row of timed) {
    const prev = current[current.length - 1];
    const startsNewPart =
      current.length === 0 ||
      (prev != null && !areSlotsInSamePart(prev, row, effectiveGapSec));
    if (startsNewPart) {
      if (current.length > 0) {
        const lastStart = current[current.length - 1]?.start_time ?? null;
        parts.push({
          index: parts.length + 1,
          rows: current,
          start_time: current[0]?.start_time ?? null,
          last_start_time: lastStart,
          is_timeless: false,
        });
      }
      current = [];
    }
    current.push(row);
  }
  if (current.length > 0) {
    const lastStart = current[current.length - 1]?.start_time ?? null;
    parts.push({
      index: parts.length + 1,
      rows: current,
      start_time: current[0]?.start_time ?? null,
      last_start_time: lastStart,
      is_timeless: false,
    });
  }
  if (timeless.length > 0) {
    parts.push({
      index: parts.length + 1,
      rows: timeless,
      start_time: null,
      last_start_time: null,
      is_timeless: true,
    });
  }
  return parts;
}

export function collapseReservationGroups(rows: SlotBase[]): SlotGroupRow[] {
  if (rows.length === 0) return [];
  const sorted = sortSlotsChronologically(rows);
  const groupMap = new Map<string, SlotBase[]>();
  for (const row of sorted) {
    const groupId = row.reservation_group_id;
    if (!groupId) continue;
    if (!groupMap.has(groupId)) groupMap.set(groupId, []);
    groupMap.get(groupId)?.push(row);
  }
  const seen = new Set<string>();
  const output: SlotGroupRow[] = [];
  for (const row of sorted) {
    const groupId = row.reservation_group_id;
    if (!groupId) {
      output.push({
        ...withoutDeprecatedEndTime(row),
        slot_ids: [row.id],
        group_id: null,
        group_size: 1,
        is_group: false,
      });
      continue;
    }
    if (seen.has(groupId)) continue;
    seen.add(groupId);
    const groupRows = sortSlotsChronologically(groupMap.get(groupId) ?? [row]);
    const first = groupRows[0];
    const last = groupRows[groupRows.length - 1];
    const status = groupRows.some((r) => r.status === "submitted")
      ? "submitted"
      : groupRows.some((r) => r.status === "reserved")
        ? "reserved"
        : "available";
    const displayName =
      groupRows.find((r) => r.display_name)?.display_name ?? first.display_name;
    const xUserId = groupRows.find((r) => r.x_user_id)?.x_user_id ?? first.x_user_id;
    const discordUserId =
      groupRows.find((r) => r.discord_user_id)?.discord_user_id ??
      first.discord_user_id;
    let slotLabel = first.slot_label;
    if (first.slot_kind === "count" && groupRows.length > 1) {
      const lastLabel = last.slot_label;
      if (lastLabel && lastLabel !== slotLabel) {
        slotLabel = `${slotLabel ?? ""}〜${lastLabel}`;
      }
    }
    output.push({
      ...withoutDeprecatedEndTime(first),
      slot_label: slotLabel,
      start_time: first.start_time ?? null,
      status,
      display_name: displayName,
      x_user_id: xUserId,
      discord_user_id: discordUserId,
      reservation_group_id: groupId,
      slot_ids: groupRows.map((r) => r.id),
      group_id: groupId,
      group_size: groupRows.length,
      is_group: groupRows.length > 1,
    });
  }
  return output;
}
