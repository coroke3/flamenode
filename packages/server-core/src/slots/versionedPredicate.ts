/** MIG-0657 U01h: shared status/version/snapshot CAS for slot updates.
 *
 * CURRENT: src/lib/slots/versionedPredicate.ts.
 * Keep exactly the same WHERE and bound-parameter ordering. The caller owns
 * authorization, row-count assertions, audit/Queue atomicity and D1 budgeting.
 */
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { slots } from "@flamenode/db/schema";

export type VersionedSlotIdentity = {
  id: string;
  version: number;
  updated_at: number;
  reserved_x_id_snapshot?: string | null;
};

export function versionedSlotWhere(
  eventId: string,
  rows: readonly VersionedSlotIdentity[],
  status?: "available" | "reserved" | "submitted",
): SQL {
  if (rows.length === 0) {
    throw new Error("versioned_slot_where_empty");
  }
  return and(
    eq(slots.event_id, eventId),
    status ? eq(slots.status, status) : undefined,
    or(
      ...rows.map((row) =>
        and(
          eq(slots.id, row.id),
          eq(slots.version, row.version),
          eq(slots.updated_at, row.updated_at),
          sql`${slots.reserved_x_id_snapshot} IS ${row.reserved_x_id_snapshot ?? null}`,
        ),
      ),
    ),
  )!;
}
