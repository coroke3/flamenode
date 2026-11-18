/**
 * MIG-0656 U02c-7a: SA-058 generated-slot three-row atomic INSERT candidate.
 * UNMOUNTED / offline-only. CURRENT creates up to 100 slots by successive
 * MAX_ATOMIC_SLOT_ROWS=3 writes; a complete multi-request S3 protocol is
 * not yet approved. This helper plans exactly ONE bounded chunk.
 *
 * A future authorized Hono caller MUST execute the collision assertion,
 * INSERT, exact changed-row assertion, strict INSERT audits and static
 * rebuild intents inside ONE mutateWithAudit D1 batch, never standalone.
 * No routes, remote D1 or Queue are touched by this module.
 */
import { sql, type SQL } from "@flamenode/server-core/sql";
import type { GeneratedSlotInsertRow } from "./slotWritePlanning.ts";

export const MAX_GENERATE_SLOT_CHUNK_ROWS = 3;
export type GenerateSlotChunkMode = "time" | "count";
export type GenerateSlotChunkAtomicPlan = {
  preMutationAssertions: SQL[];
  mutationStatement: SQL;
  expectedMutationChanges: number;
  processedCount: number;
};

const ROW_COLUMNS = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id",
  "status", "updated_at", "version",
] as const;

/** Reject malformed internal callers before any future D1 operations. */
function validateChunk(
  mode: GenerateSlotChunkMode, eventId: string,
  rows: readonly GeneratedSlotInsertRow[],
): void {
  if ((mode !== "time" && mode !== "count") ||
      typeof eventId !== "string" || !eventId.trim() ||
      eventId !== eventId.trim() || !Array.isArray(rows) ||
      rows.length < 1 || rows.length > MAX_GENERATE_SLOT_CHUNK_ROWS) {
    throw new Error("slot_generate_chunk_invalid_selection");
  }
  const ids = new Set<string>(), indexes = new Set<number>();
  const orders = new Set<number>();
  const timestamp = rows[0]?.updated_at;
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        row.id !== row.id.trim() || ids.has(row.id) ||
        row.event_id !== eventId || row.status !== "available" ||
        row.version !== 1 ||
        !Number.isSafeInteger(row.updated_at) || row.updated_at < 0 ||
        !Number.isSafeInteger(row.sort_order) || row.sort_order < 0 ||
        (row.start_time !== null && !Number.isSafeInteger(row.start_time)) ||
        (mode === "time" && row.start_time === null) ||
        (mode === "count" && row.start_time !== null) ||
        (mode === "time" && row.slot_label !== null) ||
        (mode === "count" && (typeof row.slot_label !== "string" || !row.slot_label.trim())) ||
        row.updated_at !== timestamp || orders.has(row.sort_order) ||
        row.reserved_by_user_id !== null || row.x_user_id !== null ||
        row.reserved_x_id_snapshot !== null || row.display_name !== null ||
        row.reservation_group_id !== null || row.video_id !== null) {
      throw new Error("slot_generate_chunk_invalid_snapshot");
    }
    const key = mode === "time" ? row.start_time! : row.sort_order;
    if (indexes.has(key)) throw new Error("slot_generate_chunk_duplicate_time_or_order");
    indexes.add(key);
    orders.add(row.sort_order);
    ids.add(row.id);
  }
}

/**
 * SQL uses bounded JSON1 binds. The collision key matches CURRENT:
 * start_time for time mode; sort_order for count mode, regardless of status.
 * Choice of SQL identifier is made from the closed two-option enum.
 */
export function buildGeneratedSlotChunkAtomicPlan(input: {
  mode: GenerateSlotChunkMode;
  eventId: string;
  rows: readonly GeneratedSlotInsertRow[];
}): GenerateSlotChunkAtomicPlan {
  const { mode, eventId, rows } = input;
  validateChunk(mode, eventId, rows);
  const payload = JSON.stringify(rows.map((row) =>
    Object.fromEntries(ROW_COLUMNS.map((key) => [key, row[key]])),
  ));
  const compareColumn = mode === "time" ? "start_time" : "sort_order";
  const collisionKey = sql.raw(compareColumn);
  const check = sql`
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM slots AS s
      JOIN json_each(${payload}) AS j
        ON s.event_id = ${eventId}
       AND s.${collisionKey} = json_extract(j.value, ${"$." + compareColumn})
    ) THEN 1 ELSE json_extract('invalid-generated-slot-collision', '$') END
  `;
  const insert = sql`
    INSERT INTO slots (
      id, event_id, reserved_by_user_id, x_user_id,
      reserved_x_id_snapshot, display_name, slot_label,
      start_time, sort_order, reservation_group_id, video_id,
      status, updated_at, version
    )
    SELECT
      json_extract(j.value, '$.id'),
      json_extract(j.value, '$.event_id'),
      NULL, NULL, NULL, NULL,
      json_extract(j.value, '$.slot_label'),
      json_extract(j.value, '$.start_time'),
      json_extract(j.value, '$.sort_order'),
      NULL, NULL,
      'available', json_extract(j.value, '$.updated_at'), 1
    FROM json_each(${payload}) AS j
  `;
  return {
    preMutationAssertions: [check], mutationStatement: insert,
    expectedMutationChanges: rows.length, processedCount: rows.length,
  };
}
