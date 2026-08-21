import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { slots } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { normalizeSlotReservationLimit } from "./slotReservationLimit";

function logicalReservationCountSql() {
  return sql<number>`COUNT(DISTINCT CASE
    WHEN ${slots.reservation_group_id} IS NOT NULL
      AND TRIM(${slots.reservation_group_id}) <> ''
      THEN 'group:' || ${slots.reservation_group_id}
    ELSE 'slot:' || ${slots.id}
  END)`;
}

function activeReservationSubjectWhere(eventId: string, xIdSnapshot: string) {
  return and(
    eq(slots.event_id, eventId),
    eq(slots.reserved_x_id_snapshot, xIdSnapshot),
    sql`${slots.status} IN ('reserved', 'submitted')`,
  )!;
}

export async function loadLogicalReservationCountForXId(
  db: DB,
  args: { eventId: string; xIdSnapshot: string | null },
): Promise<number> {
  const xIdSnapshot = normalizeXId(args.xIdSnapshot ?? "");
  if (!xIdSnapshot) return 0;
  const row = (
    await db
      .select({ reservation_count: logicalReservationCountSql() })
      .from(slots)
      .where(activeReservationSubjectWhere(args.eventId, xIdSnapshot))
      .limit(1)
  )[0];
  const count = Number(row?.reservation_count ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * reserve の slot UPDATE と同じ D1 batch の末尾で実行する fail-closed guard。
 * UPDATE 後の slots 正本を数えるため、同時 reserve でも上限超過側の batch 全体が
 * rollback される。公開アクセスでは呼ばれない。
 */
export function buildReservationLimitGuardStatement(
  db: DB,
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
        WHEN (
          SELECT COUNT(DISTINCT CASE
            WHEN reservation_group_id IS NOT NULL
              AND TRIM(reservation_group_id) <> ''
              THEN 'group:' || reservation_group_id
            ELSE 'slot:' || id
          END)
          FROM slots
          WHERE event_id = ${args.eventId}
            AND reserved_x_id_snapshot = ${xIdSnapshot}
            AND status IN ('reserved', 'submitted')
        ) <= ${limit}
        THEN 1
        ELSE json_extract('not-valid-json', '$')
      END
    `.inlineParams(),
  );
}
