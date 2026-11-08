/**
 * MIG-0656 U02b-1: pure selection planning for CURRENT SA-062..064.
 * The caller MUST read authoritative rows from D1 after the authenticated
 * event.slots/write guard. Group queries must use the persisted raw group
 * value and a 4-row sentinel; the eventual mutation MUST use version CAS,
 * atomic strict audit, Queue and notification effects.
 *
 * This code performs NO authorization or I/O and is NOT a mounted write API.
 */
export const MAX_ATOMIC_SLOT_WRITE_ROWS = 3;

export type SlotWriteReadRow = {
  id: string;
  event_id: string;
  status: string;
  reservation_group_id: string | null;
  reserved_by_user_id: string | null;
  x_user_id: string | null;
  version: number;
};

export type SlotWriteSelectionResult<T extends SlotWriteReadRow> =
  | { ok: true; rows: T[] }
  | { ok: false; message: string };

export type SlotWriteBatchKind = "delete-available" | "update-labels" | "release-reserved";

function validRow(row: SlotWriteReadRow, eventId: string): boolean {
  return typeof row.id === "string" && row.id.length > 0 &&
    row.event_id === eventId && Number.isSafeInteger(row.version) &&
    row.version >= 0;
}

/** Check selection IDs and authoritative per-event rows before any write. */
export function selectSlotBatchRows<T extends SlotWriteReadRow>(
  eventId: string,
  ids: readonly string[],
  rows: readonly T[],
  kind: SlotWriteBatchKind,
): SlotWriteSelectionResult<T> {
  const canonicalEventId = eventId.trim();
  if (!canonicalEventId || ids.length < 1 ||
      ids.length > MAX_ATOMIC_SLOT_WRITE_ROWS ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || id.length === 0 || id !== id.trim())) {
    return { ok: false, message: "event_id と処理上限内の枠を指定してください。" };
  }
  const seen = new Set<string>();
  const requested = new Set(ids);
  if (rows.some((row) => !validRow(row, canonicalEventId) ||
      !requested.has(row.id) || seen.has(row.id) || (seen.add(row.id), false)) ||
      seen.size !== ids.length) {
    return { ok: false, message: kind === "update-labels"
      ? "存在しない枠が含まれています。"
      : kind === "release-reserved"
        ? "対象に予約中以外または存在しない枠があります。"
        : "対象に空き枠以外または存在しない枠があります。" };
  }
  if (kind !== "update-labels" &&
      rows.some((row) => row.status !== (kind === "delete-available" ? "available" : "reserved"))) {
    return { ok: false, message: kind === "delete-available"
      ? "対象に空き枠以外または存在しない枠があります。"
      : "対象に予約中以外または存在しない枠があります。" };
  }
  return { ok: true, rows: [...rows] };
}

function sameRead(row: SlotWriteReadRow, other: SlotWriteReadRow): boolean {
  return row.event_id === other.event_id &&
    row.version === other.version &&
    row.status === other.status &&
    row.reservation_group_id === other.reservation_group_id &&
    row.reserved_by_user_id === other.reserved_by_user_id &&
    row.x_user_id === other.x_user_id;
}

/**
 * Expand CURRENT grouped reservations to whole-group releases; never silently
 * release an anchor alone when the group query returned no matching anchor.
 * groupedRows must be the COMPLETE result of SELECT ... WHERE raw
 * reservation_group_id IN (...) LIMIT 4. CAS protects the later write.
 */
export function planBatchReservedRelease<T extends SlotWriteReadRow>(
  eventId: string,
  ids: readonly string[],
  selectedRows: readonly T[],
  groupedRows: readonly T[],
): SlotWriteSelectionResult<T> {
  const selection = selectSlotBatchRows(eventId, ids, selectedRows, "release-reserved");
  if (!selection.ok) return selection;
  const requestedGroups = new Set(selectedRows
    .map((row) => row.reservation_group_id)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0));
  if (groupedRows.length > MAX_ATOMIC_SLOT_WRITE_ROWS) {
    return { ok: false, message: "一括解放で reservation_group を含む処理対象は 3 件以内です。大きな連続枠は枠ごとの強制解放を使ってください。" };
  }
  const byId = new Map(selection.rows.map((row) => [row.id, row]));
  const groupSeen = new Set<string>();
  for (const row of groupedRows) {
    if (!validRow(row, eventId.trim()) || !row.reservation_group_id ||
        !requestedGroups.has(row.reservation_group_id) ||
        groupSeen.has(row.id)) {
      return { ok: false, message: "reservation_group の読み取りが不整合です。" };
    }
    groupSeen.add(row.id);
    const selected = byId.get(row.id);
    if (selected && !sameRead(selected, row)) {
      return { ok: false, message: "指定した枠の状態が変わりました。再試行してください。" };
    }
    byId.set(row.id, row);
  }
  // For grouped selected rows, the group read must confirm the same anchor.
  // This prevents a stale, missing or truncated group lookup becoming a
  // partial user-visible release.
  if (selectedRows.some((row) => row.reservation_group_id?.trim() &&
      !groupSeen.has(row.id))) {
    return { ok: false, message: "reservation_group の読み取りが不整合です。" };
  }
  const targets = [...byId.values()];
  if (targets.length > MAX_ATOMIC_SLOT_WRITE_ROWS) {
    return { ok: false, message: "一括解放で reservation_group を含む処理対象は 3 件以内です。大きな連続枠は枠ごとの強制解放を使ってください。" };
  }
  if (targets.some((row) => row.status !== "reserved")) {
    return { ok: false, message: "reservation_group 全体が予約中ではありません。" };
  }
  for (const group of requestedGroups) {
    const members = targets.filter((row) => row.reservation_group_id === group);
    const representative = members[0];
    if (!representative || members.some((row) =>
        row.reserved_by_user_id !== representative.reserved_by_user_id ||
        row.x_user_id !== representative.x_user_id)) {
      return { ok: false, message: "reservation_group に複数の利用者が混在しています。" };
    }
  }
  return { ok: true, rows: targets };
}
