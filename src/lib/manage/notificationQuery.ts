/** Next.js returns string[] for repeated search query keys.
 * Keep scalar bytes unchanged: callers preserve each filter\'s original trim policy.
 * Treat ambiguous/non-string values as absent before downstream string operations.
 */
export function readManageNotificationQueryValue(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** Preserve the page's existing status-filter policy: only known states narrow D1. */
export function readManageNotificationStatusFilter(raw: unknown): string {
  const value = readManageNotificationQueryValue(raw).trim();
  return value === "failed" || value === "pending" || value === "processing" ||
    value === "sent" || value === "cancelled" ? value : "";
}
