export const MAX_SLOT_RESERVATIONS_PER_XID = 100;

export function normalizeSlotReservationLimit(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(
    0,
    Math.min(MAX_SLOT_RESERVATIONS_PER_XID, Math.floor(parsed)),
  );
}

export function slotReservationLimitMessage(limit: number): string {
  const normalized = normalizeSlotReservationLimit(limit);
  return normalized > 0
    ? `このイベントでは、1つのX IDにつき最大${normalized}件まで枠を確保できます。連続枠は1件として数えます。`
    : "";
}
