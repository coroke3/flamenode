/** MIG-0656 U02c: common bound per-event + linked-approved-staff + complete slot snapshot SELECT.
 * Used by unmounted SA-062 / SA-064 write candidates only. The parent router
 * MUST enforce Origin, session/TOS write guard and DB adapter before mounting.
 */
import { resolveStaffPermissionKeys, type StaffPermissionRow } from "./access.ts";
import { sql, type SQL } from "@flamenode/server-core/sql";

const SLOT_COLUMNS = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status",
  "updated_at", "version",
] as const;

export type SlotLabelWriteRow = {
  id: string;
  event_id: string;
  reserved_by_user_id: string | null;
  x_user_id: string | null;
  reserved_x_id_snapshot: string | null;
  display_name: string | null;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number;
  reservation_group_id: string | null;
  video_id: string | null;
  status: string;
  updated_at: number;
  version: number;
};

/**
 * 1 D1 pre-read: event exists, approved linked staff grants (101 sentinel),
 * 4 slot-row sentinel and full audit snapshots. Together with writeGuard's
 * actor identity and CostGuard settings this fits the three-read S3 ceiling.
 */
export const SLOT_BATCH_WRITE_SNAPSHOT_SQL = `
  SELECT
    (SELECT id FROM events WHERE id = ? LIMIT 1) AS exists_id,
    (SELECT json_group_array(json_object(
      'permission_preset', staff.permission_preset,
      'custom_permission_keys_json', staff.custom_permission_keys_json
    )) FROM (
      SELECT es.permission_preset, es.custom_permission_keys_json
      FROM event_staff es
      INNER JOIN x_user_account_links l ON l.x_user_id = es.x_user_id
      INNER JOIN x_users x ON x.id = l.x_user_id
      WHERE es.event_id = ? AND l.auth_user_id = ?
        AND x.approval_status = 'approved'
      LIMIT 101
    ) staff) AS staff_json,
    (SELECT json_group_array(json_object(
      ${SLOT_COLUMNS.map((name) => "'" + name + "', s.\"" + name + "\"").join(",\n      ")}
    )) FROM (
      SELECT s.* FROM slots s
      WHERE s.event_id = ? AND s.id IN
        (SELECT value FROM json_each(?))
      LIMIT 4
    ) s) AS slots_json
`;

export function parseSlotRows(value: string | null): SlotLabelWriteRow[] {
  const parsed: unknown = JSON.parse(value ?? "[]");
  if (!Array.isArray(parsed) || parsed.length > 3 || parsed.some((item) =>
      !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("slot_label_invalid_snapshot");
  }
  return parsed as SlotLabelWriteRow[];
}

export function canUpdateEventLabels(
  role: string | null | undefined,
  rawGrants: string | null,
): boolean {
  // CURRENT's admin snapshot short-circuits staff enumeration. A privileged
  // admin must not be denied by the 101-row staff sentinel.
  if (role === "admin") return true;
  const parsed: unknown = JSON.parse(rawGrants ?? "[]");
  if (!Array.isArray(parsed) || parsed.length > 100) {
    throw new Error("slot_label_staff_rows_truncated");
  }
  return parsed.some((item) => item && typeof item === "object" &&
    resolveStaffPermissionKeys(item as StaffPermissionRow).has("event.slots"));
}


/**
 * MIG-0656 U03r: lock down the scoped authorization snapshot in the SAME
 * D1 atomic batch as the slot mutation. A permission preset downgrade, linked
 * X-account approval loss or event deletion after the earlier Hono pre-read
 * must fail closed BEFORE any slot/strict-audit/Queue statement executes.
 * It also verifies the actor's persisted user role, non-banned state, and
 * initial TOS acceptance. Latest-major-terms and live Auth.js expiry are
 * independent parent writeGuard concerns; this is NOT a substitute for them.
 *
 * This checks the *exact* effective approved-staff row JSON from the SELECT
 * (including the 101-row sentinel) rather than reimplementing custom/alias
 * permission evaluation in SQL. SQLite IS is NULL-safe.
 * The actor's session/TOS and CostGuard gates remain the parent's responsibility.
 */
export function buildSlotChunkScopeAssertion(input: {
  eventId: string; actorUserId: string; actorRole: string; staffJson: string | null;
}): SQL {
  const { eventId, actorUserId, actorRole, staffJson } = input;
  if (!eventId || !actorUserId ||
      (actorRole !== "admin" && actorRole !== "user" && actorRole !== "moderator") ||
      typeof staffJson !== "string") {
    throw new Error("slot_chunk_invalid_scope_assertion");
  }
  return sql`
    SELECT CASE WHEN
      EXISTS(SELECT 1 FROM events WHERE id = ${eventId})
      AND EXISTS(
        SELECT 1 FROM "user" u WHERE u.id = ${actorUserId}
          AND u.role IS ${actorRole}
          AND u.is_banned IS 0 AND u.is_tos_accepted IS 1
      )
      AND (
        SELECT json_group_array(json_object(
          'permission_preset', staff.permission_preset,
          'custom_permission_keys_json', staff.custom_permission_keys_json
        )) FROM (
          SELECT es.permission_preset, es.custom_permission_keys_json
          FROM event_staff es
          JOIN x_user_account_links l ON l.x_user_id = es.x_user_id
          JOIN x_users x ON x.id = l.x_user_id
          WHERE es.event_id = ${eventId} AND l.auth_user_id = ${actorUserId}
            AND x.approval_status = 'approved'
          LIMIT 101
        ) staff
      ) IS ${staffJson}
      THEN 1 ELSE json_extract('slot-chunk-scope-changed', '$') END
  `;
}
