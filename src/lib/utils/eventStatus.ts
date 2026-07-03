import { and, eq, sql } from "drizzle-orm";
import { events } from "@/lib/db/schema";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  getEventVisibility,
  isAcceptingEntries,
  isEventArchived,
  isPublicEventVisible,
  syncLegacyEventVisibilityFlags,
  type EventDisplayStatus,
  type EventStatusInput,
  type EventVisibilityStatus,
} from "./eventStatusCore";

export {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  getEventVisibility,
  isAcceptingEntries,
  isEventArchived,
  isPublicEventVisible,
  syncLegacyEventVisibilityFlags,
};
export type { EventDisplayStatus, EventStatusInput, EventVisibilityStatus };

export function activeEventWhere(now: number = Math.floor(Date.now() / 1000)) {
  const effectiveEnd = sql`
    CASE
      WHEN ${events.end_time} IS NOT NULL THEN ${events.end_time}
      WHEN ${events.start_time} IS NOT NULL THEN ${events.start_time}
      ELSE NULL
    END
  `;

  return and(
    eq(events.visibility_status, "public"),
    sql`((${effectiveEnd}) IS NULL OR (${effectiveEnd}) > ${now})`,
  );
}

/** 公開イベント一覧・グループに載せてよいイベント。 */
export function publicListableEventWhere() {
  return eq(events.visibility_status, "public");
}
