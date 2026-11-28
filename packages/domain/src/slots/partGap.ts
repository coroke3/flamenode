/** Convert an event's slot-part gap into seconds, preserving CURRENT fallback behavior. */
export function slotPartGapSec(event: {
  readonly slot_part_gap_minutes?: number | null;
}): number {
  const minutes = event.slot_part_gap_minutes ?? 15;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60 : 15 * 60;
}
