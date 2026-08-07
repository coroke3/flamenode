import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { xIdentityRequests } from "@/lib/db/schema";
import {
  resolveReservationXIdentityFromPending,
  SLOT_RESERVATION_X_REQUEST_TYPES,
  type ReservationXIdentity,
} from "./reservationIdentityCore";

export {
  SLOT_RESERVATION_X_REQUEST_TYPES,
  type ReservationXIdentity,
} from "./reservationIdentityCore";

export function pendingSlotReservationXRequestWhere(authUserId: string) {
  return and(
    eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
    eq(xIdentityRequests.status, "pending"),
    inArray(xIdentityRequests.request_type, [
      ...SLOT_RESERVATION_X_REQUEST_TYPES,
    ]),
    isNotNull(xIdentityRequests.requested_x_id),
  )!;
}

type ReservationGuardInput = {
  user: { id: string };
  activeXId: string | null;
  approvedXIds: string[];
  hasPendingXRequest?: boolean;
};

export async function resolveReservationXIdentity(
  db: DB,
  guard: ReservationGuardInput,
): Promise<ReservationXIdentity | { error: string }> {
  const pendingRows = guard.hasPendingXRequest
    ? await db
        .select({ requested_x_id: xIdentityRequests.requested_x_id })
        .from(xIdentityRequests)
        .where(pendingSlotReservationXRequestWhere(guard.user.id))
        .orderBy(
          desc(xIdentityRequests.requested_at),
          desc(xIdentityRequests.id),
        )
    : [];

  return resolveReservationXIdentityFromPending({
    activeXId: guard.activeXId,
    approvedXIds: guard.approvedXIds,
    pendingRequestedXIds: pendingRows
      .map((row) => row.requested_x_id)
      .filter((value): value is string => Boolean(value)),
  });
}
