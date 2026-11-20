/**
 * MIG-0657 U02: server-core slot reservation limit guard (SA-065).
 * Mirrors src/lib/slots/slotReservationLimitGuard.ts without Next/src imports (D-10).
 */
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { slots } from "@flamenode/db/schema";
import { normalizeSlotReservationLimit } from "@flamenode/domain/slots/reservationLimit";
import { normalizeXId } from "@flamenode/domain/xid";
import type { ServerCoreDb } from "../db.ts";

function logicalReservationCountSql(eventId: string, xIdSnapshot: string) {
  const matchingRows = sql`
    SELECT ${slots.id} AS id, ${slots.reservation_group_id} AS reservation_group_id
    FROM ${sql.raw("slots")}
    WHERE ${slots.event_id} = ${eventId}
      AND ${slots.reserved_x_id_snapshot} = ${xIdSnapshot}
      AND ${slots.status} IN ('reserved', 'submitted')
    UNION ALL
    SELECT ${slots.id} AS id, ${slots.reservation_group_id} AS reservation_group_id
    FROM ${sql.raw("slots")}
    WHERE ${slots.event_id} = ${eventId}
      AND ${slots.reserved_x_id_snapshot} IS NOT NULL
      AND ${slots.reserved_x_id_snapshot} <> ${xIdSnapshot}
      AND lower(trim(ltrim(trim(${slots.reserved_x_id_snapshot}), '@'))) = ${xIdSnapshot}
      AND ${slots.status} IN ('reserved', 'submitted')
  `;
  return sql`
    SELECT COUNT(DISTINCT CASE
      WHEN matched.reservation_group_id IS NOT NULL
        AND TRIM(matched.reservation_group_id) <> ''
        THEN 'group:' || TRIM(matched.reservation_group_id)
      ELSE 'slot:' || matched.id
    END) AS reservation_count
    FROM (${matchingRows}) AS matched
  `;
}

export async function loadLogicalReservationCountForXId(
  db: ServerCoreDb,
  args: { eventId: string; xIdSnapshot: string | null },
): Promise<number> {
  const xIdSnapshot = normalizeXId(args.xIdSnapshot ?? "");
  if (!xIdSnapshot) return 0;
  const rows = (await db.all(logicalReservationCountSql(args.eventId, xIdSnapshot))) as Array<{
    reservation_count?: unknown;
  }>;
  const count = Number(rows[0]?.reservation_count ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function buildReservationLimitGuardStatement(
  db: ServerCoreDb,
  args: {
    eventId: string;
    xIdSnapshot: string | null;
    limit: number;
  },
): BatchItem<"sqlite"> | null {
  const limit = normalizeSlotReservationLimit(args.limit);
  const xIdSnapshot = normalizeXId(args.xIdSnapshot ?? "");
  if (limit <= 0 || !xIdSnapshot) return null;

  return db.run(
    sql`
      SELECT CASE
        WHEN (${logicalReservationCountSql(args.eventId, xIdSnapshot)}) <= ${limit}
        THEN 1
        ELSE json_extract('not-valid-json', '$')
      END
    `.inlineParams(),
  );
}
