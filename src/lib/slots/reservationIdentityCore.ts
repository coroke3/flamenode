import { normalizeXId } from "../utils/xid.ts";

export const SLOT_RESERVATION_X_REQUEST_TYPES = [
  "new_link",
  "existing_link",
  "alias",
] as const;

export type ReservationXIdentity = {
  snapshotXId: string;
  canonicalXUserId: string | null;
};

export function resolveReservationXIdentityFromPending(input: {
  activeXId: string | null;
  approvedXIds: readonly string[];
  pendingRequestedXIds: readonly string[];
}): ReservationXIdentity | { error: string } {
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

  if (distinct.length >= 2) {
    return {
      error: "複数の X ID 申請が保留中です。Active X ID を確定してください。",
    };
  }

  return {
    error: "枠確保に必要な X ID がありません。X ID を申請または承認してください。",
  };
}
