/**
 * MIG-0656 U02b-3: bounded CURRENT SA-062..064 D1 mutation statements.
 * Returned SQL must ONLY be run by an authenticated Hono handler inside
 * mutateWithAudit({mutationStatements, expectedMutationChanges, audits}).
 * For grouped reserved release, also run buildSlotReservedReleasePrecondition()
 * as a SAME-BATCH preMutationAssertion to prevent phantom group members.
 * Nothing in this module grants permission, writes remotely, or mounts a route.
 */
import { sql, type SQL } from "@flamenode/server-core/sql";
import { MAX_ATOMIC_SLOT_WRITE_ROWS } from "./slotWriteSelection.ts";

export type SlotBatchCasRow = {
  id: string;
  event_id: string;
  version: number;
  updated_at: number;
  reserved_x_id_snapshot: string | null;
};

export type SlotBatchMutationInput = {
  kind: "delete-available" | "release-reserved" | "update-labels";
  eventId: string;
  rows: readonly SlotBatchCasRow[];
  updatedAt?: number;
  label?: string;
};

/**
 * One bounded D1 mutation statement with a single JSON1 CAS snapshot bind.
 * expectedMutationChanges MUST equal input.rows.length in the caller's
 * mutateWithAudit batch or the entire batch must roll back.
 */
export function buildSlotBatchCasMutation(input: SlotBatchMutationInput): SQL {
  const eventId = input.eventId.trim();
  const ids = new Set<string>();
  if (!eventId || input.rows.length < 1 ||
      input.rows.length > MAX_ATOMIC_SLOT_WRITE_ROWS ||
      !["delete-available", "release-reserved", "update-labels"].includes(input.kind)) {
    throw new Error("slot_batch_mutation_invalid_input");
  }
  for (const row of input.rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        row.id !== row.id.trim() || ids.has(row.id) ||
        row.event_id !== eventId ||
        !Number.isSafeInteger(row.version) || row.version < 0 ||
        !Number.isSafeInteger(row.updated_at) ||
        (row.reserved_x_id_snapshot !== null &&
         typeof row.reserved_x_id_snapshot !== "string")) {
      throw new Error("slot_batch_mutation_invalid_snapshot");
    }
    ids.add(row.id);
  }
  const kind = input.kind;
  if (kind !== "delete-available" && !Number.isSafeInteger(input.updatedAt)) {
    throw new Error("slot_batch_mutation_invalid_timestamp");
  }
  const label = input.label?.trim();
  if (kind === "update-labels" && (!label || label.length > 200)) {
    throw new Error("slot_batch_mutation_invalid_label");
  }
  const snapshot = JSON.stringify(input.rows.map((row) => ({
    id: row.id,
    version: row.version,
    updated_at: row.updated_at,
    reserved_x_id_snapshot: row.reserved_x_id_snapshot,
  })));

  // Use SQLite IS for nullable snapshots. CAS checks happen in the actual
  // DML, not only in an earlier SELECT, and values remain SQL bind parameters.
  const predicate = sql`
    EXISTS (
      SELECT 1 FROM json_each(${snapshot}) AS expected
      WHERE json_extract(expected.value, '$.id') = slots.id
        AND json_extract(expected.value, '$.version') = slots.version
        AND json_extract(expected.value, '$.updated_at') = slots.updated_at
        AND json_extract(expected.value, '$.reserved_x_id_snapshot')
            IS slots.reserved_x_id_snapshot
    )
  `;
  if (kind === "delete-available") {
    return sql`
      DELETE FROM slots
      WHERE event_id = ${eventId} AND status = 'available'
        AND ${predicate}
    `;
  }
  const now = input.updatedAt!;
  if (kind === "update-labels") {
    return sql`
      UPDATE slots
      SET slot_label = ${label!}, updated_at = ${now},
          version = version + 1
      WHERE event_id = ${eventId} AND ${predicate}
    `;
  }
  return sql`
    UPDATE slots
    SET status = 'available', reserved_by_user_id = NULL,
        x_user_id = NULL, reserved_x_id_snapshot = NULL,
        display_name = NULL, reservation_group_id = NULL,
        video_id = NULL, updated_at = ${now}, version = version + 1
    WHERE event_id = ${eventId} AND status = 'reserved'
      AND ${predicate}
  `;
}