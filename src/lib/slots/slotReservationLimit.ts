export const MAX_SLOT_RESERVATIONS_PER_XID = 100;

export function normalizeSlotReservationLimit(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(
    0,
    Math.min(MAX_SLOT_RESERVATIONS_PER_XID, Math.floor(parsed)),
  );
}

export function slotReservationLimitMessage(limit: number): string {
  const normalized = normalizeSlotReservationLimit(limit);
  return normalized > 0
    ? `このイベントでは、1つのX IDにつき最大${normalized}件まで枠を確保できます。連続枠は1件として数えます。`
    : "";
}

export type LogicalReservationRow = {
  id: string;
  reservation_group_id: string | null;
};

/**
 * DB側の COUNT(DISTINCT CASE ...) と同じ論理予約キーを返す。
 * 連続枠は group 単位、legacy / 単枠の null group は slot 単位で数える。
 */
export function logicalReservationKey(row: LogicalReservationRow): string {
  const groupId = row.reservation_group_id?.trim();
  return groupId ? `group:${groupId}` : `slot:${row.id}`;
}

export function countLogicalReservations(
  rows: readonly LogicalReservationRow[],
): number {
  return new Set(rows.map(logicalReservationKey)).size;
}

/**
 * 1 logical reservation から1枠を解放した後の論理予約件数差分。
 * 中央解放で左右に分裂すると +1、端の解放や単枠解放は 0 / -1。
 */
export function releaseLogicalReservationDelta(
  groupSize: number,
  targetIndex: number,
): number {
  if (!Number.isInteger(groupSize) || groupSize < 1) {
    throw new Error("invalid_group_size");
  }
  if (
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= groupSize
  ) {
    throw new Error("invalid_target_index");
  }
  const remainingSegments =
    (targetIndex > 0 ? 1 : 0) + (targetIndex < groupSize - 1 ? 1 : 0);
  return remainingSegments - 1;
}
