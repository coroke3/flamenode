import { and, eq, or, type SQL } from "drizzle-orm";
import { slots } from "@/lib/db/schema";

export type VersionedSlotIdentity = {
  id: string;
  version: number;
  updated_at: number;
};

/**
 * 複数枠を 1 本の UPDATE で CAS するための共通 WHERE。
 * 列は event_id / status / (id+version+updated_at) に限定し、
 * 20 枠でも D1 bind 上限 (100) 内に収める。
 */
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
        ),
      ),
    ),
  )!;
}
