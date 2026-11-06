/** Search query normalization shared by CURRENT /entry/unslotted and its regression tests. */
export function normalizeUnslottedEventQuery(raw: unknown): string {
  // Next.js searchParams may be string[] when the URL repeats event_q.
  // Ignore ambiguous keys rather than throwing on .trim() or guessing a value.
  if (typeof raw !== "string") return "";
  const clipped = raw.trim().slice(0, 100);
  // Prevent a 100 UTF-16-unit truncation from emitting an orphan high surrogate.
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}
