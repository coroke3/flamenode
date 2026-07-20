import { and, eq, sql } from "drizzle-orm";
import { events } from "@/lib/db/schema";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  getEventVisibility,
  isAcceptingEntries,
  isPublicEventVisible,
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
  isPublicEventVisible,
};
export type { EventDisplayStatus, EventStatusInput, EventVisibilityStatus };

export function activeEventWhere(now: number = Math.floor(Date.now() / 1000)) {
  return and(
    eq(events.visibility_status, "public"),
    sql`(${events.end_time} IS NULL OR ${events.end_time} > ${now})`,
  );
}

/** 公開イベント一覧・グループに載せてよいイベント。 */
export function publicListableEventWhere() {
  return eq(events.visibility_status, "public");
}
