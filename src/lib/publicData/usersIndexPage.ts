/** Canonical /user page query contract shared by CURRENT Next and the Astro Island.
 * Do not use parseInt: it silently accepts numeric prefixes such as "2abc" and "3.5".
 */
export function parseUsersIndexPage(raw: unknown): number {
  // Next may supply string[] for duplicate query keys despite a string-only page type.
  // Non-string input must never throw or be coerced into a partial page number.
  const value = typeof raw === "string" ? raw.trim() : "";
  // Bound input cost and require the entire query value to be a positive decimal integer.
  if (value.length === 0 || value.length > 32 || !/^[0-9]+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
