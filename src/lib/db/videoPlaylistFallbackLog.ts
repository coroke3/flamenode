/**
 * Diagnostics must never prevent the public event playlist's R2 -> D1 fallback.
 * Only the logging sink is best effort; DB/R2 and visibility failures remain
 * governed by their existing error and authorization paths.
 */
export type EventPlaylistFallbackReason =
  | "r2_missing"
  | "r2_invalid"
  | "r2_incomplete"
  | "r2_error";

export function logEventPlaylistFallback(
  eventId: string,
  reason: EventPlaylistFallbackReason,
): void {
  try {
    console.warn(JSON.stringify({
      event: "event_playlist_d1_fallback",
      reason,
      event_id: eventId,
    }));
  } catch {
    // An unavailable or throwing diagnostic sink must not abort the D1 fallback.
  }
}
