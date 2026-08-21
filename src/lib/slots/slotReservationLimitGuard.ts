import "server-only";

import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { slots } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { normalizeSlotReservationLimit } from "./slotReservationLimit";

/**
 * 0053以前のraw snapshotを正規化済み値と同じ論理X IDへ集約する。
 *
 * ORでexact/legacy条件を1つのWHEREにまとめると、SQLite/D1が部分indexを
 * 利用できずslots全走査へ退行する。exact branchとnormalized fallbackを
 * UNION ALLへ分け、fallback側ではexact値を除外して重複を防ぐ。
 */
function logicalReservationCountSql(
  eventId: string,
  xIdSnapshot: string,
) {
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
  db: DB,
  args: { eventId: string; xIdSnapshot: string | null },
): Promise<number> {
  const xIdSnapshot = normalizeXId(args.xIdSnapshot ?? "");
  if (!xIdSnapshot) return 0;
  const row = (
    await db.all(logicalReservationCountSql(args.eventId, xIdSnapshot))
  )[0] as { reservation_count?: unknown } | undefined;
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
        WHEN (${logicalReservationCountSql(args.eventId, xIdSnapshot)}) <= ${limit}
        THEN 1
        ELSE json_extract('not-valid-json', '$')
      END
    `.inlineParams(),
  );
}
