/** URL / route-safe event IDs used for newly-created events and admin rename. */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Browser empty-string ID means "let the server generate it"; preserve other input untouched. */
export function normalizeOptionalEventId(value: unknown): unknown {
  // EventForm intentionally leaves ID blank to request an auto-generated ID.
  // Treat the browser's empty string as omitted instead of failing `.min(1)`.
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}
