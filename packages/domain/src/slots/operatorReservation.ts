import {
  getEventVisibility,
  isAcceptingEntries,
  type EventStatusInput,
} from "../event/status.ts";

/**
 * An authorized event operator may reserve before public entry begins,
 * but never when the event is private or already finished.
 * Shared by CURRENT Next and the Hono viewer overlay to prevent drift.
 */
export function canUseSlotOperatorOverride(
  event: EventStatusInput,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (getEventVisibility(event) !== "public") return false;
  if (event.end_time != null && now >= event.end_time) return false;
  if (isAcceptingEntries(event, now)) return true;

  // The exception applies only *before* the entry window, not after it closes.
  if (event.entry_start_time == null || now >= event.entry_start_time) {
    return false;
  }
  if (event.entry_end_time != null && now >= event.entry_end_time) {
    return false;
  }
  return true;
}
