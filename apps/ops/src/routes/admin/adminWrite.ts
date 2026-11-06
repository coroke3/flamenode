// MIG-0734: shared handling of a D-17-3 write result in the cost guard / notification screens.
import type { AdminWriteResult } from "../../api/adminCostGuard.js";

/** An expired session (401 without an `ok` body) leaves the console like an admin-read 401 does (D-17-2). */
export function leaveWhenAnonymous(result: AdminWriteResult, assign: (url: string) => void = (url) => window.location.assign(url)): boolean {
  if (!result.anonymous) return false;
  assign("/entry");
  return true;
}
