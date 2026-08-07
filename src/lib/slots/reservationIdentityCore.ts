import { normalizeXId } from "../utils/xid.ts";

export const SLOT_RESERVATION_X_REQUEST_TYPES = [
  "new_link",
  "existing_link",
  "alias",
] as const;

/** 枠確保時に記録する X ID スナップショット。Discord-only 予約では null 可。 */
export type ReservationXIdentity = {
  snapshotXId: string | null;
  canonicalXUserId: string | null;
};

/**
 * pending 申請・active X から枠確保用の X スナップショットを解決する。
 * エラーは返さず、解決不能時は null を返す（Discord-only 枠確保）。
 */
export function resolveReservationXIdentityFromPending(input: {
  activeXId: string | null;
  approvedXIds: readonly string[];
  pendingRequestedXIds: readonly string[];
}): ReservationXIdentity {
  const activeXId = input.activeXId ? normalizeXId(input.activeXId) : null;
  const approvedSet = new Set(
    input.approvedXIds.map((id) => normalizeXId(id)).filter(Boolean),
  );

  if (activeXId && approvedSet.has(activeXId)) {
    return { snapshotXId: activeXId, canonicalXUserId: activeXId };
  }

  if (activeXId) {
    return { snapshotXId: activeXId, canonicalXUserId: null };
  }

  const pending = input.pendingRequestedXIds
    .map((id) => normalizeXId(id))
    .filter(Boolean);
  const distinct = [...new Set(pending)];

  if (distinct.length === 1) {
    return { snapshotXId: distinct[0]!, canonicalXUserId: null };
  }

  return { snapshotXId: null, canonicalXUserId: null };
}
