/** 投稿枠の表示順・区切り・予約グループ表示に使う純粋ロジック。 */

/**
 * 枠UIが受け取る最小形。
 *
 * DB正本の列だけを意味のあるプロパティとして扱う。画面や集計ごとに部分SELECTを
 * 使用できるよう、グループ化に不要な列は任意とする。
 * `priority_reclaim_*` は旧UIを段階的に除去する間だけ許可する読み取り境界であり、
 * DB正本・書き込み対象・グループ判定には使用しない。
 */
export type SlotBase = {
  id: string;
  event_id?: string;
  slot_label: string | null;
  start_time: number | null;
  sort_order?: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  reserved_by_user_id?: string | null;
  reservation_group_id?: string | null;
  video_id?: string | null;
  updated_at?: number;
  version?: number;
  event_title?: string | null;
  /** @deprecated 旧UI読取境界。DB正本には存在しない。 */
  priority_reclaim_video_id?: string | null;
  /** @deprecated 旧UI読取境界。DB正本には存在しない。 */
  priority_reclaim_until?: number | null;
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

const JST_OFFSET_SEC = 9 * 60 * 60;

function jstDayBucket(unixSec: number | null): number | null {
  return unixSec == null || !Number.isFinite(unixSec)
    ? null
    : Math.floor((unixSec + JST_OFFSET_SEC) / (24 * 60 * 60));
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
    const startDiff = (a.start_time ?? 0) - (b.start_time ?? 0);
    if (startDiff !== 0) return startDiff;
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
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
        start_time: current[0]?.start_time ?? null,
        last_start_time: current.at(-1)?.start_time ?? null,
        is_timeless: current[0]?.start_time == null,
      });
      current = [];
    }
    current.push(row);
  }
  if (current.length > 0) {
    parts.push({
      index: parts.length + 1,
      rows: current,
      start_time: current[0]?.start_time ?? null,
      last_start_time: current.at(-1)?.start_time ?? null,
      is_timeless: current[0]?.start_time == null,
    });
  }
  return parts;
}

export function collapseReservationGroups(rows: SlotBase[]): SlotGroupRow[] {
  const sorted = sortSlotsChronologically(rows);
  const grouped = new Map<string, SlotBase[]>();
  for (const row of sorted) {
    if (row.reservation_group_id) {
      const current = grouped.get(row.reservation_group_id) ?? [];
      current.push(row);
      grouped.set(row.reservation_group_id, current);
    }
  }

  const seen = new Set<string>();
  return sorted.flatMap((row): SlotGroupRow[] => {
    const groupId = row.reservation_group_id ?? null;
    if (!groupId) {
      return [{ ...row, slot_ids: [row.id], group_id: null, group_size: 1, is_group: false }];
    }
    if (seen.has(groupId)) return [];
    seen.add(groupId);
    const groupRows = sortSlotsChronologically(grouped.get(groupId) ?? [row]);
    const first = groupRows[0] ?? row;
    const last = groupRows.at(-1) ?? first;
    const status = groupRows.some((candidate) => candidate.status === "submitted")
      ? "submitted"
      : groupRows.some((candidate) => candidate.status === "reserved")
        ? "reserved"
        : "available";
    const firstLabel = first.slot_label;
    const lastLabel = last.slot_label;
    const label =
      first.start_time == null && groupRows.length > 1 && lastLabel !== firstLabel
        ? `${firstLabel ?? ""}〜${lastLabel ?? ""}`
        : firstLabel;
    return [
      {
        ...first,
        slot_label: label,
        status,
        display_name:
          groupRows.find((candidate) => candidate.display_name)?.display_name ?? null,
        x_user_id: groupRows.find((candidate) => candidate.x_user_id)?.x_user_id ?? null,
        reserved_by_user_id:
          groupRows.find((candidate) => candidate.reserved_by_user_id)
            ?.reserved_by_user_id ?? null,
        reservation_group_id: groupId,
        slot_ids: groupRows.map((candidate) => candidate.id),
        group_id: groupId,
        group_size: groupRows.length,
        is_group: groupRows.length > 1,
      },
    ];
  });
}
