import { and, eq, sql } from "drizzle-orm";
import { events } from "@/lib/db/schema";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
  type EventDisplayStatus,
  type EventStatusInput,
} from "./eventStatusCore";

export {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
};
export type { EventDisplayStatus, EventStatusInput };

export function activeEventWhere(now: number = Math.floor(Date.now() / 1000)) {
  const effectiveEnd = sql`
    CASE
      WHEN ${events.end_time} IS NOT NULL THEN ${events.end_time}
      WHEN ${events.start_time} IS NOT NULL THEN ${events.start_time}
      ELSE NULL
    END
  `;

  return and(
    eq(events.is_active, 1),
    eq(events.is_archived, 0),
    sql`((${effectiveEnd}) IS NULL OR (${effectiveEnd}) > ${now})`,
  );
}
