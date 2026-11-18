/**
 * MIG-0656 U02c-6b: SA-059 one-chunk deletion D1 CAS plan, UNMOUNTED.
 *
 * CURRENT SA-059 deletes ALL available slots in a series of audited 3-row
 * commits. The future Hono S3 caller may commit ONE chunk per invocation
 * only after an explicit resumable protocol and partial-progress UX are
 * approved. This helper does not implement or promise full deletion.
 *
 * This plan MUST be executed only after Origin-first session/writeGuard/TOS,
 * CostGuard(manage_slot_delete), DB injection and event.slots authorization.
 * The caller MUST bind the mutation, its exact changes assertion, strict
 * per-row DELETE audit and 3 projection intents in the SAME mutateWithAudit
 * D1 batch. Never call its DML standalone in production.
 */
import type { SQL } from "@flamenode/server-core/sql";
import { ALL_AVAILABLE_DELETE_MAX_ROWS, type AvailableDeleteChunkSelection } from "./slotAvailableDeleteChunkSnapshot.ts";
import { buildSlotBatchAtomicPlan } from "./slotWriteMutations.ts";

export type AvailableDeleteChunkAtomicPlan = {
  mutationStatement: SQL;
  preMutationAssertions: SQL[];
  expectedMutationChanges: number;
  processedCount: number;
  /** Read-time only: new rows may appear at any time. NOT a completion claim. */
  moreAtSnapshot: boolean;
};

export function buildAvailableDeleteChunkAtomicPlan(input: {
  eventId: string;
  selection: AvailableDeleteChunkSelection;
}): AvailableDeleteChunkAtomicPlan {
  const { eventId, selection } = input;
  if (!eventId || eventId.trim() !== eventId || !selection.ok ||
      !Array.isArray(selection.rows) ||
      selection.rows.length < 1 || selection.rows.length > ALL_AVAILABLE_DELETE_MAX_ROWS ||
      typeof selection.hasMore !== "boolean") {
    throw new Error("slot_available_delete_chunk_invalid_selection");
  }
  const ids = new Set<string>();
  for (const row of selection.rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        row.id !== row.id.trim() || ids.has(row.id) ||
        row.event_id !== eventId || row.status !== "available" ||
        !Number.isSafeInteger(row.version) || row.version < 0 ||
        !Number.isSafeInteger(row.updated_at) ||
        (row.reserved_x_id_snapshot !== null &&
          typeof row.reserved_x_id_snapshot !== "string")) {
      throw new Error("slot_available_delete_chunk_invalid_snapshot");
    }
    ids.add(row.id);
  }

  // Reuse SA-061/062's well-tested three-row D1 CAS statement. It predicates
  // exact id/event/status/version/updatedAt/x-snapshot in the same DELETE.
  const plan = buildSlotBatchAtomicPlan({
    kind: "delete-available", eventId, rows: selection.rows,
  });
  return {
    ...plan,
    processedCount: selection.rows.length,
    moreAtSnapshot: selection.hasMore,
  };
}
