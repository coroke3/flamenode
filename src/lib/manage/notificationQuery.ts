/** Next.js returns string[] for repeated search query keys.
 * Treat ambiguous or non-string filters as absent instead of crashing during trim().
 */
export function readManageNotificationQueryValue(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}
