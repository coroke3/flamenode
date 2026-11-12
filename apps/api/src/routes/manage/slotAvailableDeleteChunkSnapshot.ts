/**
 * MIG-0656 U02c-6a: SA-059 available-slot deletion candidate snapshot.
 * READ-ONLY / UNMOUNTED. CURRENT deletes all available slots in successive
 * MAX_ATOMIC_SLOT_ROWS (3) chunks, but the Hono S3 budget permits <=3
 * pre-reads and ONE D1 batch per invocation. This module plans ONE chunk
 * only: a later approved HTTP protocol must preserve all-row UX semantics
 * without silently treating the first 3 slots as the complete operation.
 */
import type { SlotLabelWriteRow } from "./slotWriteScopedRead.ts";
import { SLOT_CHUNK_COST_GUARD_SELECT } from "./slotChunkCostGuard.ts";

export const ALL_AVAILABLE_DELETE_MAX_ROWS = 3;
const FIELDS = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status",
  "updated_at", "version",
].map(key => "'" + key + "', s.\"" + key + "\"").join(", ");

export const SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL = [
  "SELECT",
  "(SELECT id FROM events WHERE id = ? LIMIT 1) AS exists_id,",
  "(SELECT json_group_array(json_object(",
  " 'permission_preset', staff.permission_preset,",
  " 'custom_permission_keys_json', staff.custom_permission_keys_json",
  ")) FROM (",
  " SELECT es.permission_preset, es.custom_permission_keys_json",
  " FROM event_staff es",
  " JOIN x_user_account_links l ON l.x_user_id = es.x_user_id",
  " JOIN x_users x ON x.id = l.x_user_id",
  " WHERE es.event_id = ? AND l.auth_user_id = ?",
  " AND x.approval_status = 'approved' LIMIT 101",
  ") staff) AS staff_json,",
  SLOT_CHUNK_COST_GUARD_SELECT + ",",
  "(SELECT json_group_array(json_object(" + FIELDS + ")) FROM (",
  " SELECT s.* FROM slots s WHERE s.event_id = ? AND s.status = 'available'",
  " ORDER BY s.id ASC LIMIT " + (ALL_AVAILABLE_DELETE_MAX_ROWS + 1),
  ") s) AS rows_json",
].join("\n");

export type AvailableDeleteChunkRead = {
  exists_id: string | null;
  staff_json: string | null;
  cost_guard_json: string | null;
  rows_json: string | null;
};
export type AvailableDeleteChunkSelection =
  | { ok: true; rows: SlotLabelWriteRow[]; hasMore: boolean }
  | { ok: false; message: string };

function isCompleteRow(item: unknown, eventId: string): item is SlotLabelWriteRow {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const row = item as Record<string, unknown>;
  const optionalText = [
    "reserved_by_user_id", "x_user_id", "reserved_x_id_snapshot",
    "display_name", "slot_label", "reservation_group_id", "video_id",
  ];
  return typeof row.id === "string" && row.id.trim().length > 0 &&
    row.id === row.id.trim() && row.event_id === eventId &&
    row.status === "available" &&
    Number.isSafeInteger(row.version) && (row.version as number) >= 0 &&
    Number.isSafeInteger(row.updated_at) &&
    Number.isSafeInteger(row.sort_order) &&
    (row.start_time === null || Number.isSafeInteger(row.start_time)) &&
    optionalText.every(k => row[k] === null || typeof row[k] === "string");
}

/**
 * Permission MUST be checked before calling this parser, using
 * canUpdateEventLabels(role, read.staff_json), then read.exists_id.
 * It never authorizes, writes, audits, or starts a second D1 read.
 */
export function selectAvailableDeleteChunk(
  eventId: string,
  read: Pick<AvailableDeleteChunkRead, "rows_json">,
): AvailableDeleteChunkSelection {
  if (typeof eventId !== "string" || !eventId.trim() || eventId !== eventId.trim()) {
    return { ok: false, message: "イベントIDが不正です。" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.rows_json ?? "[]");
  } catch {
    return { ok: false, message: "空き枠の読み取り結果が不正です。" };
  }
  if (!Array.isArray(parsed) || parsed.length > ALL_AVAILABLE_DELETE_MAX_ROWS + 1 ||
      parsed.some(row => !isCompleteRow(row, eventId))) {
    return { ok: false, message: "空き枠の読み取り結果が不正です。" };
  }
  const ids = new Set(parsed.map(row => row.id));
  if (ids.size !== parsed.length) {
    return { ok: false, message: "空き枠の読み取り結果が不正です。" };
  }
  return {
    ok: true,
    rows: (parsed as SlotLabelWriteRow[]).slice(0, ALL_AVAILABLE_DELETE_MAX_ROWS),
    hasMore: parsed.length > ALL_AVAILABLE_DELETE_MAX_ROWS,
  };
}
