/** 投稿枠の表示順・区切り・予約グループ表示に使う純粋ロジック。 */

import type { SlotViewerRelation } from "@/lib/slots/slotIdentityCore";

export type SlotIntegrityError = "mixed_status" | "mixed_viewer_relation";

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
  slot_label: string | null;
  start_time: number | null;
  sort_order?: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  is_owned_by_viewer: boolean;
  viewer_relation?: SlotViewerRelation;
  group_key: string | null;
  reserved_x_id?: string | null;
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
  integrity_error: SlotIntegrityError | null;
};

export type SlotAnnotatedRow = SlotBase &
  SlotGroupRow & {
    group_position: number;
    group_first_slot_id: string;
    group_last_slot_id: string;
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

function buildReservationGroupIndex(rows: SlotBase[]): Map<string, SlotBase[]> {
  const sorted = sortSlotsChronologically(rows);
  const grouped = new Map<string, SlotBase[]>();
  for (const row of sorted) {
    if (row.group_key) {
      const current = grouped.get(row.group_key) ?? [];
      current.push(row);
      grouped.set(row.group_key, current);
    }
  }
  return grouped;
}

export function annotateReservationGroups(rows: SlotBase[]): SlotAnnotatedRow[] {
  const sorted = sortSlotsChronologically(rows);
  const grouped = buildReservationGroupIndex(rows);

  return sorted.map((row): SlotAnnotatedRow => {
    const groupId = row.group_key;
    if (!groupId) {
      return {
        ...row,
        group_id: null,
        group_size: 1,
        group_position: 1,
        slot_ids: [row.id],
        group_first_slot_id: row.id,
        group_last_slot_id: row.id,
        is_group: false,
        integrity_error: null,
      };
    }
    const groupRows = sortSlotsChronologically(grouped.get(groupId) ?? [row]);
    const first = groupRows[0] ?? row;
    const last = groupRows.at(-1) ?? first;
    const groupPosition =
      groupRows.findIndex((candidate) => candidate.id === row.id) + 1;
    return {
      ...row,
      group_id: groupId,
      group_size: groupRows.length,
      group_position: groupPosition,
      slot_ids: groupRows.map((candidate) => candidate.id),
      group_first_slot_id: first.id,
      group_last_slot_id: last.id,
      is_group: groupRows.length > 1,
      integrity_error: null,
    };
  });
}

export function collapseReservationGroups(rows: SlotBase[]): SlotGroupRow[] {
  const sorted = sortSlotsChronologically(rows);
  const grouped = buildReservationGroupIndex(rows);

  const seen = new Set<string>();
  return sorted.flatMap((row): SlotGroupRow[] => {
    const groupId = row.group_key;
    if (!groupId) {
      return [
        {
          ...row,
          slot_ids: [row.id],
          group_id: null,
          group_size: 1,
          is_group: false,
          integrity_error: null,
        },
      ];
    }
    if (seen.has(groupId)) return [];
    seen.add(groupId);
    const groupRows = sortSlotsChronologically(grouped.get(groupId) ?? [row]);
    const first = groupRows[0] ?? row;
    const last = groupRows.at(-1) ?? first;
    const hasReserved = groupRows.some(
      (candidate) => candidate.status === "reserved",
    );
    const hasSubmitted = groupRows.some(
      (candidate) => candidate.status === "submitted",
    );
    const statuses = new Set(groupRows.map((candidate) => candidate.status));
    const status = hasSubmitted
      ? "submitted"
      : hasReserved
        ? "reserved"
        : "available";
    let integrity_error: SlotIntegrityError | null = null;
    if (statuses.size > 1) {
      integrity_error = "mixed_status";
    } else {
      const relations = groupRows
        .map((candidate) => candidate.viewer_relation)
        .filter((relation): relation is SlotViewerRelation => relation != null);
      const distinctRelations = new Set(relations);
      // active+unassigned は Server の null adoption と両立するため integrity エラーにしない。
      // account_other / none との混在のみ安全側に倒す。
      const actorOnly = [...distinctRelations].every(
        (relation) => relation === "active" || relation === "unassigned",
      );
      if (distinctRelations.size > 1 && !actorOnly) {
        integrity_error = "mixed_viewer_relation";
      }
    }
    const resolvedViewerRelation = (() => {
      const relations = groupRows
        .map((candidate) => candidate.viewer_relation)
        .filter((relation): relation is SlotViewerRelation => relation != null);
      if (relations.includes("active")) return "active" as const;
      if (relations.includes("unassigned")) return "unassigned" as const;
      return first.viewer_relation;
    })();
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
        viewer_relation: resolvedViewerRelation,
        is_owned_by_viewer: integrity_error
          ? false
          : groupRows.every((candidate) => candidate.is_owned_by_viewer),
        group_key: groupId,
        slot_ids: groupRows.map((candidate) => candidate.id),
        group_id: groupId,
        group_size: groupRows.length,
        is_group: groupRows.length > 1,
        integrity_error,
      },
    ];
  });
}
