/**
 * MIG-0656 U02b-2: atomic pre-mutation membership/CAS snapshot guard.
 * Call ONLY inside the same mutateWithAudit D1 batch as versioned writes,
 * strict audit and queue mutations. This helper provides no auth or route.
 */
import { sql, type SQL } from "@flamenode/server-core/sql";
import { MAX_ATOMIC_SLOT_WRITE_ROWS, type SlotWriteReadRow } from "./slotWriteSelection.ts";

export type SlotReleaseSnapshotRow = SlotWriteReadRow & {
  updated_at: number;
  reserved_x_id_snapshot: string | null;
};

/** A single SQLite statement: all externally supplied values are bound. */
export function buildSlotReservedReleasePrecondition(
  eventId: string,
  rows: readonly SlotReleaseSnapshotRow[],
): SQL {
  const canonicalId = eventId.trim();
  if (!canonicalId || rows.length < 1 || rows.length > MAX_ATOMIC_SLOT_WRITE_ROWS) {
    throw new Error("slot_release_invalid_snapshot");
  }
  const ids = new Set<string>();
  const byGroup = new Map<string, SlotReleaseSnapshotRow>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        row.id !== row.id.trim() || row.event_id !== canonicalId ||
        row.status !== "reserved" ||
        !Number.isSafeInteger(row.version) || row.version < 0 ||
        !Number.isSafeInteger(row.updated_at) ||
        (row.reservation_group_id !== null && typeof row.reservation_group_id !== "string") ||
        (row.reserved_by_user_id !== null && typeof row.reserved_by_user_id !== "string") ||
        (row.x_user_id !== null && typeof row.x_user_id !== "string") ||
        (row.reserved_x_id_snapshot !== null && typeof row.reserved_x_id_snapshot !== "string") ||
        ids.has(row.id)) {
      throw new Error("slot_release_invalid_snapshot");
    }
    ids.add(row.id);
    const group = row.reservation_group_id;
    // CURRENT treats whitespace-only group IDs as solo, but preserves raw
    // stored values for all nonblank groups.
    if (group?.trim()) {
      const leader = byGroup.get(group);
      if (leader && (leader.reserved_by_user_id !== row.reserved_by_user_id ||
          leader.x_user_id !== row.x_user_id)) {
        throw new Error("slot_release_mixed_reservation_group");
      }
      byGroup.set(group, leader ?? row);
    }
  }
  const expected = JSON.stringify(rows.map((row) => ({
    id: row.id, event_id: row.event_id, status: row.status,
    version: row.version, updated_at: row.updated_at,
    reservation_group_id: row.reservation_group_id,
    reserved_by_user_id: row.reserved_by_user_id,
    x_user_id: row.x_user_id,
    reserved_x_id_snapshot: row.reserved_x_id_snapshot,
  })));

  // Compare both the complete live raw group membership and every selected
  // row's full CAS-sensitive fields. Reject phantoms, moves and stale rows
  // BEFORE the mutation, not only after a read outside the D1 batch.
  return sql`
    WITH expected AS (
      SELECT
        json_extract(j.value, '$.id') AS id,
        json_extract(j.value, '$.event_id') AS event_id,
        json_extract(j.value, '$.status') AS status,
        json_extract(j.value, '$.version') AS version,
        json_extract(j.value, '$.updated_at') AS updated_at,
        json_extract(j.value, '$.reservation_group_id') AS reservation_group_id,
        json_extract(j.value, '$.reserved_by_user_id') AS reserved_by_user_id,
        json_extract(j.value, '$.x_user_id') AS x_user_id,
        json_extract(j.value, '$.reserved_x_id_snapshot') AS reserved_x_id_snapshot
      FROM json_each(${expected}) AS j
    ),
    actual AS (
      SELECT s.* FROM slots AS s
      WHERE s.event_id = ${canonicalId}
        AND (
          s.id IN (SELECT id FROM expected)
          OR s.reservation_group_id IN (
            SELECT reservation_group_id FROM expected
            WHERE reservation_group_id IS NOT NULL
              AND trim(reservation_group_id) <> ''
          )
        )
    )
    SELECT CASE WHEN
      (SELECT COUNT(*) FROM actual) = ${rows.length}
      AND (SELECT COUNT(*) FROM actual AS s
        INNER JOIN expected AS e ON s.id = e.id
        WHERE s.event_id = e.event_id
          AND s.status = e.status
          AND s.version = e.version
          AND s.updated_at = e.updated_at
          AND s.reservation_group_id IS e.reservation_group_id
          AND s.reserved_by_user_id IS e.reserved_by_user_id
          AND s.x_user_id IS e.x_user_id
          AND s.reserved_x_id_snapshot IS e.reserved_x_id_snapshot
      ) = ${rows.length}
    THEN 1 ELSE json_extract('not-valid-json', '$') END
  `;
}