/**
 * MIG-0656 U02c-5b: SA-060 single-slot reserved release atomic SQL plan.
 * UNMOUNTED / offline-only. SA-060 can release up to 20 same-group slots;
 * SA-063's three-slot helpers MUST remain independent.
 *
 * The eventual Hono route MUST run preMutationAssertions, mutationStatement,
 * exactly matched changes, strict before/after audits, outbox and rebuild
 * queue inside ONE mutateWithAudit D1 batch after Origin/session/writeGuard
 * and event.slots authorization. This builder does none of those effects.
 */
import { sql, type SQL } from "@flamenode/server-core/sql";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import type { SlotLabelWriteRow } from "./slotWriteScopedRead.ts";

export type SingleReleaseAtomicPlan = {
  preMutationAssertions: SQL[];
  mutationStatement: SQL;
  expectedMutationChanges: number;
};

function validateReleaseRows(eventId: string, rows: readonly SlotLabelWriteRow[]): string | null {
  if (!eventId || eventId !== eventId.trim() ||
      rows.length < 1 || rows.length > MAX_SLOTS_PER_VIDEO) {
    throw new Error("slot_single_release_invalid_selection");
  }
  const ids = new Set<string>();
  const anchor = rows[0];
  if (!anchor) throw new Error("slot_single_release_invalid_selection");
  const group = anchor.reservation_group_id;
  const activeGroup = group?.trim() ? group : null;
  if (!activeGroup && rows.length !== 1) {
    throw new Error("slot_single_release_solo_has_extra_rows");
  }
  for (const row of rows) {
    if (!row || typeof row.id !== "string" ||
        !row.id.trim() || row.id !== row.id.trim() || ids.has(row.id) ||
        row.event_id !== eventId || row.status !== "reserved" ||
        (row.reservation_group_id !== null && typeof row.reservation_group_id !== "string") ||
        typeof row.version !== "number" || !Number.isSafeInteger(row.version) ||
        row.version < 0 || typeof row.updated_at !== "number" ||
        !Number.isSafeInteger(row.updated_at) ||
        (row.reserved_by_user_id !== null && typeof row.reserved_by_user_id !== "string") ||
        (row.x_user_id !== null && typeof row.x_user_id !== "string") ||
        (row.reserved_x_id_snapshot !== null &&
          typeof row.reserved_x_id_snapshot !== "string") ||
        row.reserved_by_user_id !== anchor.reserved_by_user_id ||
        row.x_user_id !== anchor.x_user_id ||
        (activeGroup !== null && row.reservation_group_id !== activeGroup)) {
      throw new Error("slot_single_release_invalid_snapshot");
    }
    ids.add(row.id);
  }
  return activeGroup;
}

/**
 * Bounded JSON1 snapshot:
 * - all selected rows must still match their full read-time fields
 * - no unselected member with the SAME raw group key may exist
 * - no reserved/stale/phantom row may be partly released.
 * SQL runs as a same-D1-batch assertion, not an unsafe preliminary SELECT.
 */
export function buildSlotSingleReleaseAtomicPlan(input: {
  eventId: string;
  rows: readonly SlotLabelWriteRow[];
  updatedAt: number;
}): SingleReleaseAtomicPlan {
  const { eventId, rows, updatedAt } = input;
  const activeGroup = validateReleaseRows(eventId, rows);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw new Error("slot_single_release_invalid_timestamp");
  }
  const expected = JSON.stringify(rows.map(row => ({
    id: row.id, event_id: row.event_id, status: row.status,
    version: row.version, updated_at: row.updated_at,
    reservation_group_id: row.reservation_group_id,
    reserved_by_user_id: row.reserved_by_user_id, x_user_id: row.x_user_id,
    reserved_x_id_snapshot: row.reserved_x_id_snapshot,
  })));
  const groupKeys = JSON.stringify(activeGroup ? [activeGroup] : []);

  // SQLite trim() is ASCII-only. The active group is chosen using JS trim(),
  // but group membership itself is matched against the raw persisted value.
  const precondition = sql`
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
      WHERE s.event_id = ${eventId}
        AND (
          s.id IN (SELECT id FROM expected)
          OR s.reservation_group_id IN (
            SELECT value FROM json_each(${groupKeys})
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
    THEN 1 ELSE json_extract('invalid-slot-single-release-snapshot', '$') END
  `;

  const mutationStatement = sql`
    UPDATE slots SET
      status = 'available', reserved_by_user_id = NULL,
      x_user_id = NULL, reserved_x_id_snapshot = NULL,
      display_name = NULL, reservation_group_id = NULL,
      video_id = NULL, updated_at = ${updatedAt}, version = version + 1
    WHERE event_id = ${eventId} AND status = 'reserved'
      AND EXISTS (
        SELECT 1 FROM json_each(${expected}) AS j
        WHERE json_extract(j.value, '$.id') = slots.id
          AND json_extract(j.value, '$.version') = slots.version
          AND json_extract(j.value, '$.updated_at') = slots.updated_at
          AND json_extract(j.value, '$.reservation_group_id')
              IS slots.reservation_group_id
          AND json_extract(j.value, '$.reserved_by_user_id')
              IS slots.reserved_by_user_id
          AND json_extract(j.value, '$.x_user_id') IS slots.x_user_id
          AND json_extract(j.value, '$.reserved_x_id_snapshot')
              IS slots.reserved_x_id_snapshot
      )
  `;

  return {
    preMutationAssertions: [precondition],
    mutationStatement,
    expectedMutationChanges: rows.length,
  };
}
