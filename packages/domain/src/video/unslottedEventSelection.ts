export type UnslottedEventSyncErrorCode =
  | "unslotted_event_selection_invalid"
  | "unslotted_event_not_allowed";

export class UnslottedEventSyncError extends Error {
  // Node 22 --experimental-strip-types cannot execute TS parameter properties.
  readonly code: UnslottedEventSyncErrorCode;

  constructor(code: UnslottedEventSyncErrorCode) {
    super(code);
    this.code = code;
    this.name = "UnslottedEventSyncError";
  }
}

/** 枠なし投稿専用。event_ids の汎用複数選択形式を0件または1件へ縮約する。 */
export function parseUnslottedEventIdFromForm(formData: FormData): string | null {
  const raw = formData.get("event_ids");
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
  }

  // This field selects at most one distinct event. Avoid materializing an
  // unbounded array of comma-separated inputs (and a second Set allocation).
  let selected: string | null = null;
  let cursor = 0;
  while (cursor <= raw.length) {
    const comma = raw.indexOf(",", cursor);
    const end = comma === -1 ? raw.length : comma;
    const value = raw.slice(cursor, end).trim();
    if (value.length > 64 || (value && selected !== null && value !== selected)) {
      throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
    }
    if (value && selected === null) selected = value;
    if (comma === -1) break;
    cursor = comma + 1;
  }
  return selected;
}
