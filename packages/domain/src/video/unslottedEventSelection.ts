export type UnslottedEventSyncErrorCode =
  | "unslotted_event_selection_invalid"
  | "unslotted_event_not_allowed";

export class UnslottedEventSyncError extends Error {
  constructor(readonly code: UnslottedEventSyncErrorCode) {
    super(code);
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

  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.some((value) => value.length > 64)) {
    throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
  }
  const unique = Array.from(new Set(values));
  if (unique.length > 1) {
    throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
  }
  return unique[0] ?? null;
}
