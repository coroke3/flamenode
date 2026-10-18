/** Moved unchanged from src/lib/utils/dateInput.ts (MIG-0303); that file re-exports it. */
export type JstDatetimeLocalParseResult =
  | { ok: true; value: number | null }
  | { ok: false; reason: "invalid_datetime" };

/**
 * Parse an HTML datetime-local value as Asia/Tokyo without Date.parse
 * fallbacks or Date.UTC date normalisation.  Empty input is valid and maps
 * to null; a non-empty malformed/out-of-range value is rejected.
 */
export function parseJstDatetimeLocalStrict(
  raw: string | null | undefined,
): JstDatetimeLocalParseResult {
  if (raw == null || raw.trim() === "") return { ok: true, value: null };
  const s = raw.trim();
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return { ok: false, reason: "invalid_datetime" };

  const [, yRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw = "0"] = m;
  const year = Number(yRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  if (
    year < 100 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return { ok: false, reason: "invalid_datetime" };
  }

  const timestampMs = Date.UTC(
    year,
    month - 1,
    day,
    hour - 9,
    minute,
    second,
  );
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "invalid_datetime" };
  }
  // Date.UTC normalises 2026-02-30 etc.; round-trip in JST to reject it.
  const roundTrip = new Date(timestampMs + 9 * 60 * 60 * 1000);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second
  ) {
    return { ok: false, reason: "invalid_datetime" };
  }
  return { ok: true, value: Math.floor(timestampMs / 1000) };
}
