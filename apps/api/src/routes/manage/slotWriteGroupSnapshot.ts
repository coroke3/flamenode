/**
 * MIG-0656 U02c-2a: SA-063 one-read whole-group selection, UNMOUNTED.
 * In an eventual handler the mandatory group-membership CAS assertion must
 * execute inside the SAME strict audited batch as release + notification +
 * static rebuild queue. This module has no authorization or side effects.
 */
import { parseSlotRows, type SlotLabelWriteRow } from "./slotWriteScopedRead.ts";
import {
  planBatchReservedRelease, type SlotWriteSelectionResult,
} from "./slotWriteSelection.ts";

// Tracked against the canonical audit snapshot by a SQLite regression test.
const SLOT_COLUMNS = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status", "updated_at", "version",
] as const;
const FIELDS = SLOT_COLUMNS.map(name => "'" + name + "', s.\"" + name + "\"").join(", ");

/**
 * One bounded D1 SELECT. Bind values:
 * eventId, eventId, userId, eventId, JSON(ids), eventId, eventId, JSON(ids).
 * Group IDs compare RAW. SQLite trim differs from JS Unicode trim, so
 * JS-blank group keys are filtered later by the pure selection function.
 */
export const SLOT_BATCH_RELEASE_SNAPSHOT_SQL = [
  "SELECT",
  "(SELECT id FROM events WHERE id = ? LIMIT 1) AS exists_id,",
  "(SELECT json_group_array(json_object(",
  "  'permission_preset', staff.permission_preset,",
  "  'custom_permission_keys_json', staff.custom_permission_keys_json",
  ")) FROM (",
  " SELECT es.permission_preset, es.custom_permission_keys_json",
  " FROM event_staff es",
  " INNER JOIN x_user_account_links l ON l.x_user_id = es.x_user_id",
  " INNER JOIN x_users x ON x.id = l.x_user_id",
  " WHERE es.event_id = ? AND l.auth_user_id = ?",
  " AND x.approval_status = 'approved' LIMIT 101",
  ") staff) AS staff_json,",
  "(SELECT json_group_array(json_object(" + FIELDS + ")) FROM (",
  " SELECT s.* FROM slots s WHERE s.event_id = ?",
  " AND s.id IN (SELECT value FROM json_each(?)) LIMIT 4",
  ") s) AS slots_json,",
  "(SELECT json_group_array(json_object(" + FIELDS + ")) FROM (",
  " SELECT s.* FROM slots s WHERE s.event_id = ?",
  " AND s.reservation_group_id IN (",
  " SELECT DISTINCT picked.reservation_group_id FROM slots picked",
  " WHERE picked.event_id = ?",
  " AND picked.id IN (SELECT value FROM json_each(?))",
  " AND picked.reservation_group_id IS NOT NULL",
  " ) LIMIT 4",
  ") s) AS grouped_slots_json",
].join("\n");

export type SlotBatchReleaseRead = {
  exists_id: string | null;
  staff_json: string | null;
  slots_json: string | null;
  grouped_slots_json: string | null;
};
function parseGroupRows(raw: string | null): SlotLabelWriteRow[] {
  const parsed: unknown = JSON.parse(raw ?? "[]");
  if (!Array.isArray(parsed) || parsed.length > 4 ||
    parsed.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("slot_release_invalid_group_snapshot");
  }
  return parsed as SlotLabelWriteRow[];
}

/** Pure selection. Never authorize using the untrusted ids alone. */
export function selectBatchReservedReleaseSnapshot(
  eventId: string, selectedIds: readonly string[],
  read: Pick<SlotBatchReleaseRead, "slots_json" | "grouped_slots_json">,
): SlotWriteSelectionResult<SlotLabelWriteRow> {
  const selected = parseSlotRows(read.slots_json);
  const grouped = parseGroupRows(read.grouped_slots_json);
  const active = new Set(selected.map(row => row.reservation_group_id)
    .filter((key): key is string =>
      typeof key === "string" && key.trim().length > 0));
  const relevant = grouped.filter(row =>
    row.reservation_group_id !== null && active.has(row.reservation_group_id));
  // Any hidden phantom member is still rejected by same-batch precondition
  // before release mutation, even if another blank group occupies the LIMIT 4.
  return planBatchReservedRelease(eventId, selectedIds, selected, relevant);
}
