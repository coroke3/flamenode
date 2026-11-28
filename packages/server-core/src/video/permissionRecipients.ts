import { and, eq, sql } from "drizzle-orm";
import { users, xUserAccountLinks, xUsers } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import { MAX_COLLABORATOR_PERMISSION_BATCH } from "@flamenode/domain/video/atomicLimits";

/**
 * CURRENT SA-082..084 notification recipient read, without Next.js dependencies.
 *
 * Resolve only approved X identities whose linked auth accounts have enabled
 * notifications. Preserve CURRENT's case-insensitive X ID matching and avoid
 * treating an unlinked / rejected / disabled account as a recipient.
 *
 * This is a read helper. The eventual Hono write must still enqueue its
 * notifications atomically with its audited permission mutation.
 */
export async function loadNotifiableRecipientLinks(
  db: ServerCoreDb,
  xids: readonly string[],
): Promise<Array<{ x_user_id: string; auth_user_id: string }>> {
  if (xids.length === 0) return [];
  // The canonical permission request is at most 100 X IDs. Reject an
  // oversized host invocation before allocating a JSON payload or reading D1.
  // This remains fail-closed even if a future Hono adapter omits its body cap.
  if (xids.length > MAX_COLLABORATOR_PERMISSION_BATCH) {
    throw new Error("notification_recipient_batch_limit_exceeded");
  }
  const payload = JSON.stringify(Array.from(new Set(xids)));
  return db
    .select({
      x_user_id: xUserAccountLinks.x_user_id,
      auth_user_id: xUserAccountLinks.auth_user_id,
    })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .innerJoin(users, eq(users.id, xUserAccountLinks.auth_user_id))
    .where(
      and(
        sql`lower(${xUserAccountLinks.x_user_id}) IN (
          SELECT lower(CAST(value AS TEXT)) FROM json_each(${payload})
        )`,
        eq(xUsers.approval_status, "approved"),
        eq(users.is_notification_enabled, 1),
      )!,
    );
}
