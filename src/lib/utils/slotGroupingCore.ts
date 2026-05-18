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
  end_time: number | null;
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

export type SlotPart<T extends { start_time: number | null; end_time: number | null }> = {
  index: number;
  rows: T[];
  start_time: number | null;
  end_time: number | null;
  is_timeless: boolean;
};

export type SlotGroupRow = SlotBase & {
  slot_ids: string[];
  group_id: string | null;
  group_size: number;
  is_group: boolean;
};

const JST_OFFSET_SEC = 9 * 60 * 60;

function jstDayBucket(unixSec: number | null): number | null {
  if (unixSec == null || !Number.isFinite(unixSec)) return null;
  return Math.floor((unixSec + JST_OFFSET_SEC) / (24 * 60 * 60));
}

export function sortSlotsChronologically<
  T extends {
    id?: string | null;
    start_time: number | null;
    end_time: number | null;
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
    const aEnd = a.end_time ?? aStart;
    const bEnd = b.end_time ?? bStart;
    if (aEnd !== bEnd) return aEnd - bEnd;
    const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (sortDiff !== 0) return sortDiff;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}

export function buildSlotParts<
  T extends {
    start_time: number | null;
    end_time: number | null;
    slot_kind?: string | null;
  },
>(rows: T[], gapSec = 30 * 60): SlotPart<T>[] {
  if (rows.length === 0) return [];
  const timed = sortSlotsChronologically(rows.filter((r) => r.start_time != null));
  const timeless = rows.filter((r) => r.start_time == null);
  const effectiveGapSec =
    Number.isFinite(gapSec) && gapSec >= 0 ? gapSec : 30 * 60;
  const parts: SlotPart<T>[] = [];
  let current: T[] = [];
  let prevEnd = 0;
  for (const row of timed) {
    const start = row.start_time ?? 0;
    const prev = current[current.length - 1];
    const startsNewPart =
      current.length === 0 ||
      start - prevEnd > effectiveGapSec ||
      (prev != null && (prev.slot_kind ?? null) !== (row.slot_kind ?? null)) ||
      (prev != null && jstDayBucket(prev.start_time) !== jstDayBucket(row.start_time));
    if (startsNewPart) {
      if (current.length > 0) {
        parts.push({
          index: parts.length + 1,
          rows: current,
          start_time: current[0]?.start_time ?? null,
          end_time:
            current[current.length - 1]?.end_time ??
            current[current.length - 1]?.start_time ??
            null,
          is_timeless: false,
        });
      }
      current = [];
    }
    current.push(row);
    prevEnd = row.end_time ?? row.start_time ?? prevEnd;
  }
  if (current.length > 0) {
    parts.push({
      index: parts.length + 1,
      rows: current,
      start_time: current[0]?.start_time ?? null,
      end_time:
        current[current.length - 1]?.end_time ??
        current[current.length - 1]?.start_time ??
        null,
      is_timeless: false,
    });
  }
  if (timeless.length > 0) {
    parts.push({
      index: parts.length + 1,
      rows: timeless,
      start_time: null,
      end_time: null,
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
        ...row,
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
    const hasTime = first.start_time != null;
    output.push({
      ...first,
      slot_label: slotLabel,
      start_time: first.start_time ?? null,
      end_time: hasTime
        ? last.end_time ?? last.start_time ?? first.end_time
        : null,
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
