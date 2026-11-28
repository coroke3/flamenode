/**
 * MIG-0656 U02c-5a: SA-060 single reserved-slot release read candidate.
 * UNMOUNTED, read-only. CURRENT permits up to MAX_SLOTS_PER_VIDEO (20)
 * members for this action, unlike SA-063's three-row batch release.
 *
 * The eventual Hono handler MUST authorize event.slots before interpreting
 * existence, and use a same-batch group-membership assertion, version CAS,
 * strict long audits, notification outbox, and rebuild queue. This read
 * alone does not make any later mutation safe.
 */
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import type { SlotLabelWriteRow } from "./slotWriteScopedRead.ts";
import type { SlotWriteSelectionResult } from "./slotWriteSelection.ts";
import { SLOT_CHUNK_COST_GUARD_SELECT } from "./slotChunkCostGuard.ts";

const COLUMNS = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status",
  "updated_at", "version",
] as const;
const FIELDS = COLUMNS.map(name => "'" + name + "', s.\"" + name + "\"").join(", ");

/**
 * One D1 statement, eight bound values:
 * eventId, eventId, userId, eventId, slotId,
 * eventId, eventId, slotId.
 * The group comparison is against the RAW stored key, not SQL trim(), which
 * is not equivalent to JavaScript trim() for Unicode whitespace.
 */
export const SLOT_SINGLE_RELEASE_SNAPSHOT_SQL = [
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
  "(SELECT json_object(" + FIELDS + ") FROM slots s",
  " WHERE s.event_id = ? AND s.id = ? LIMIT 1) AS anchor_json,",
  "(SELECT json_group_array(json_object(" + FIELDS + ")) FROM (",
  " SELECT s.* FROM slots s WHERE s.event_id = ?",
  " AND s.reservation_group_id = (",
  "  SELECT a.reservation_group_id FROM slots a",
  "  WHERE a.event_id = ? AND a.id = ? LIMIT 1",
  " ) LIMIT " + (MAX_SLOTS_PER_VIDEO + 1),
  ") s) AS group_json",
].join("\n");

export type SlotSingleReleaseRead = {
  exists_id: string | null;
  staff_json: string | null;
  cost_guard_json: string | null;
  anchor_json: string | null;
  group_json: string | null;
};

function isRow(value: unknown, eventId: string): value is SlotLabelWriteRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<SlotLabelWriteRow>;
  return typeof row.id === "string" && row.id.length > 0 &&
    row.event_id === eventId &&
    typeof row.status === "string" &&
    (row.reservation_group_id === null ||
      typeof row.reservation_group_id === "string") &&
    typeof row.version === "number" && Number.isSafeInteger(row.version) && row.version >= 0 &&
    typeof row.updated_at === "number" && Number.isSafeInteger(row.updated_at);
}

/**
 * Only validates one snapshot. Authorization and the atomic mutation are
 * deliberately out of scope for this micro-unit.
 */
export function selectSingleReservedReleaseSnapshot(
  eventId: string,
  slotId: string,
  read: Pick<SlotSingleReleaseRead, "anchor_json" | "group_json">,
): SlotWriteSelectionResult<SlotLabelWriteRow> {
  if (!eventId || !slotId || eventId !== eventId.trim() ||
      slotId !== slotId.trim()) {
    return { ok: false, message: "指定した枠の状態が変わりました。再試行してください。" };
  }
  const anchorUnknown: unknown = JSON.parse(read.anchor_json ?? "null");
  if (anchorUnknown === null) return { ok: false, message: "枠が見つかりません。" };
  if (!isRow(anchorUnknown, eventId) || anchorUnknown.id !== slotId) {
    return { ok: false, message: "指定した枠の状態が変わりました。再試行してください。" };
  }
  const anchor = anchorUnknown;
  if (anchor.status !== "reserved") {
    return { ok: false, message: "予約中の枠だけ解放できます。" };
  }
  const groupId = anchor.reservation_group_id?.trim() || null;
  if (!groupId) return { ok: true, rows: [anchor] };

  const groupUnknown: unknown = JSON.parse(read.group_json ?? "[]");
  if (!Array.isArray(groupUnknown) ||
      groupUnknown.length > MAX_SLOTS_PER_VIDEO + 1 ||
      groupUnknown.some(row => !isRow(row, eventId) ||
        row.reservation_group_id !== anchor.reservation_group_id)) {
    return { ok: false, message: "指定した枠の状態が変わりました。再試行してください。" };
  }
  if (groupUnknown.length === 0 || groupUnknown.length > MAX_SLOTS_PER_VIDEO) {
    return {
      ok: false,
      message: "一度に解放できる枠は " + MAX_SLOTS_PER_VIDEO + " 件までです。",
    };
  }
  const rows = groupUnknown as SlotLabelWriteRow[];
  const seen = new Set(rows.map(row => row.id));
  if (seen.size !== rows.length) {
    return { ok: false, message: "指定した枠の状態が変わりました。再試行してください。" };
  }
  const selectedAnchor = rows.find(row => row.id === anchor.id);
  if (!selectedAnchor ||
      selectedAnchor.version !== anchor.version ||
      selectedAnchor.updated_at !== anchor.updated_at ||
      selectedAnchor.status !== anchor.status ||
      selectedAnchor.reserved_by_user_id !== anchor.reserved_by_user_id ||
      selectedAnchor.x_user_id !== anchor.x_user_id) {
    return { ok: false, message: "指定した枠の状態が変わりました。再試行してください。" };
  }
  if (rows.some(row => row.status !== "reserved" ||
      row.reserved_by_user_id !== anchor.reserved_by_user_id ||
      row.x_user_id !== anchor.x_user_id)) {
    return { ok: false, message: "対象グループ全体が同一利用者の予約中ではありません。" };
  }
  return { ok: true, rows };
}
