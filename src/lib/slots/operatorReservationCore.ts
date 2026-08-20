import {
  getEventVisibility,
  isAcceptingEntries,
  type EventStatusInput,
} from "../utils/eventStatusCore.ts";

/**
 * Event operators may reserve before the public entry window, but only while
 * the event itself is still live.  This is intentionally pure so the page and
 * the server action cannot drift on the boundary conditions.
 */
export function canUseSlotOperatorOverride(
  event: EventStatusInput,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (getEventVisibility(event) !== "public") return false;
  if (event.end_time != null && now >= event.end_time) return false;
  if (isAcceptingEntries(event, now)) return true;

  // The exception is specifically for the period before entry_start_time.
  // A closed/ended event must not become reservable through this override.
  if (event.entry_start_time == null || now >= event.entry_start_time) {
    return false;
  }
  if (event.entry_end_time != null && now >= event.entry_end_time) {
    return false;
  }
  if (event.end_time != null && now >= event.end_time) return false;
  return true;
}
