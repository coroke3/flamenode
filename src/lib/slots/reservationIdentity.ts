import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { xIdentityRequests } from "@/lib/db/schema";
import {
  resolveReservationXIdentityFromPending,
  SLOT_RESERVATION_X_REQUEST_TYPES,
  type ReservationXIdentity,
} from "./reservationIdentityCore";
import { normalizeXId } from "@/lib/utils/xid";

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
  const activeXId = guard.activeXId ? normalizeXId(guard.activeXId) : null;
  const approvedSet = new Set(
    guard.approvedXIds.map((id) => normalizeXId(id)).filter(Boolean),
  );
  const activeApproved = Boolean(activeXId && approvedSet.has(activeXId));

  // 承認済み Active があるときだけ pending 読取を省略する。
  // 却下/未承認 Active が残っていても pending を読み、誤 snapshot を防ぐ。
  const pendingRows = activeApproved
    ? []
    : await db
        .select({ requested_x_id: xIdentityRequests.requested_x_id })
        .from(xIdentityRequests)
        .where(pendingSlotReservationXRequestWhere(guard.user.id))
        .orderBy(
          desc(xIdentityRequests.requested_at),
          desc(xIdentityRequests.id),
        );

  return resolveReservationXIdentityFromPending({
    activeXId: guard.activeXId,
    approvedXIds: guard.approvedXIds,
    pendingRequestedXIds: pendingRows
      .map((row) => row.requested_x_id)
      .filter((value): value is string => Boolean(value)),
  });
}
