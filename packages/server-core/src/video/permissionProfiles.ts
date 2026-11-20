import { sql } from "drizzle-orm";
import { xUsers } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";

/**
 * SA-082..084 shared X-profile read prior to the atomic permission mutation.
 * Keep CURRENT's casefolded JSON1 lookup and one-extra-row bound. A later
 * Hono writer must still enforce canonical alias resolution and rejected-X
 * restrictions before scheduling mutation statements.
 */
export async function loadPermissionGrantProfiles(
  db: ServerCoreDb,
  grantXids: readonly string[],
): Promise<Array<{ id: string; approval_status: string | null }>> {
  if (grantXids.length === 0) return [];
  return db
    .select({
      id: xUsers.id,
      approval_status: xUsers.approval_status,
    })
    .from(xUsers)
    .where(sql`lower(${xUsers.id}) IN (
      SELECT lower(CAST(value AS TEXT))
      FROM json_each(${JSON.stringify(grantXids)})
    )`)
    .limit(grantXids.length + 1);
}
