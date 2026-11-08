/**
 * Next.js searchParams may contain string[] when a query key is repeated.
 * Treat ambiguous and malformed values as absent instead of selecting an
 * arbitrary filter or passing arrays into string-only operations.
 * Preserve scalar contents: each page applies its own existing trim rules.
 */
export function readSingleSearchParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}
