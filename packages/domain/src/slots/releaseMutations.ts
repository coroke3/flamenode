import { buildReleaseGroupDecisions } from "./releaseGroups.ts";

/** Pure mutation plan for SA-066. No database, audit, queue, or authorization effects. */
export type SlotReleaseMutationPlan<Row> = {
  rows: Row[];
  patch:
    | {
        reserved_by_user_id: null;
        x_user_id: null;
        reserved_x_id_snapshot: null;
        display_name: null;
        reservation_group_id: null;
        status: "available";
      }
    | { reservation_group_id: string | null };
  statusGuard: "reserved";
};

/**
 * Preserve CURRENT's ordered, grouped D1 UPDATE plans. The caller generates
 * newGroupId, authorizes the actor, and executes the CAS+audit batch.
 */
export function buildSlotReleaseMutationPlan<
  Row extends { id: string; reservation_group_id: string | null },
>(
  groupRows: readonly Row[],
  anchorId: string,
  newGroupId: string,
): SlotReleaseMutationPlan<Row>[] {
  const decisions = new Map(
    buildReleaseGroupDecisions(groupRows, anchorId, { newGroupId }).map(
      (decision) => [decision.id, decision],
    ),
  );
  const mutations: SlotReleaseMutationPlan<Row>[] = [];
  const releasedRows = groupRows.filter(
    (row) => decisions.get(row.id)?.release,
  );
  if (releasedRows.length > 0) {
    mutations.push({
      rows: [...releasedRows],
      patch: {
        reserved_by_user_id: null,
        x_user_id: null,
        reserved_x_id_snapshot: null,
        display_name: null,
        reservation_group_id: null,
        status: "available" as const,
      },
      statusGuard: "reserved",
    });
  }

  const groupByTarget = new Map<string | null, Row[]>();
  for (const row of groupRows) {
    const decision = decisions.get(row.id);
    if (!decision || decision.release) continue;
    if (decision.reservation_group_id === row.reservation_group_id) continue;
    const key = decision.reservation_group_id;
    const current = groupByTarget.get(key) ?? [];
    current.push(row);
    groupByTarget.set(key, current);
  }
  for (const [targetGroupId, rows] of groupByTarget) {
    mutations.push({
      rows,
      patch: { reservation_group_id: targetGroupId },
      statusGuard: "reserved",
    });
  }
  return mutations;
}
