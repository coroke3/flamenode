import type { ReservationXIdentity } from "./reservationIdentity.ts";

/**
 * SA-065 pure slot reservation mutation planner. All validation (status,
 * ownership, adjacency, group size), X identity resolution, ID generation,
 * audit, notification outbox, and atomic D1 CAS remain the caller's work.
 * The returned single bulk mutation preserves CURRENT's query budget.
 */
export function buildSlotReserveMutationPlan<Row>(
  input: {
    rows: readonly Row[];
    actorUserId: string;
    identity: ReservationXIdentity;
    displayName: string | null;
    groupId: string | null;
  },
): Array<{
  rows: Row[];
  patch: {
    reserved_by_user_id: string;
    x_user_id: string | null;
    reserved_x_id_snapshot: string | null;
    display_name: string | null;
    reservation_group_id: string | null;
    status: "reserved";
  };
  statusGuard: "available";
}> {
  return [{
    rows: [...input.rows],
    patch: {
      reserved_by_user_id: input.actorUserId,
      x_user_id: input.identity.canonicalXUserId,
      reserved_x_id_snapshot: input.identity.snapshotXId,
      display_name: input.displayName,
      reservation_group_id: input.groupId,
      status: "reserved",
    },
    statusGuard: "available",
  }];
}
