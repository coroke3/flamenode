import { parseJstDatetimeLocalStrict } from "../utils/dateInput.ts";

export const EVENT_DATE_FIELDS = [
  "start_time",
  "end_time",
  "entry_start_time",
  "entry_end_time",
] as const;

export type EventDateField = (typeof EVENT_DATE_FIELDS)[number];
export type EventDateValues = Partial<Record<EventDateField, string | null | undefined>>;

export type EventDateValidation =
  | { ok: true; timestamps: ReadonlyMap<EventDateField, number | null> }
  | { ok: false; field: EventDateField; message: string };

/**
 * Validate the four independent event windows before any D1 mutation.
 * Empty values remain valid (point events may omit a window), while malformed
 * datetime-local values and reversed ranges fail closed.
 */
export function validateEventDateValues(values: EventDateValues): EventDateValidation {
  const timestamps = new Map<EventDateField, number | null>();
  for (const field of EVENT_DATE_FIELDS) {
    const result = parseJstDatetimeLocalStrict(values[field]);
    if (!result.ok) {
      return {
        ok: false,
        field,
        message: `${field}: invalid datetime`,
      };
    }
    timestamps.set(field, result.value);
  }

  const start = timestamps.get("start_time");
  const end = timestamps.get("end_time");
  if (start != null && end != null && start > end) {
    return {
      ok: false,
      field: "start_time",
      message: "start_time must not be later than end_time",
    };
  }

  const entryStart = timestamps.get("entry_start_time");
  const entryEnd = timestamps.get("entry_end_time");
  if (entryStart != null && entryEnd != null && entryStart > entryEnd) {
    return {
      ok: false,
      field: "entry_start_time",
      message: "entry_start_time must not be later than entry_end_time",
    };
  }

  return { ok: true, timestamps };
}
