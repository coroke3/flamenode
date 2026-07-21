import { inArray } from "drizzle-orm";
import { xUsers } from "@/lib/db/schema";
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "./publicXUser";

/** Drizzle where 断片（既定: x_users.approval_status）。 */
export function publicListableXApprovalWhere(
  column: typeof xUsers.approval_status = xUsers.approval_status,
) {
  return inArray(column, [...PUBLIC_LISTABLE_X_APPROVAL_STATUSES]);
}
