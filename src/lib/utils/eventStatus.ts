import { and, eq, sql } from "drizzle-orm";
import { events } from "@/lib/db/schema";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  getEventVisibility,
  isAcceptingEntries,
  isPointEvent,
  isPublicEventVisible,
  normalizeEventVisibility,
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
  isPointEvent,
  isPublicEventVisible,
  normalizeEventVisibility,
};
export type { EventDisplayStatus, EventStatusInput, EventVisibilityStatus };

/** 点イベント以外（両方未設定、または両方設定済み）。 */
export function boundedOrOpenEndedEventPeriodWhere() {
  return sql`(
    (${events.start_time} IS NULL AND ${events.end_time} IS NULL)
    OR (${events.start_time} IS NOT NULL AND ${events.end_time} IS NOT NULL)
  )`;
}

export function activeEventWhere(now: number = Math.floor(Date.now() / 1000)) {
  return and(
    eq(events.visibility_status, "public"),
    boundedOrOpenEndedEventPeriodWhere(),
    sql`(${events.end_time} IS NULL OR ${events.end_time} > ${now})`,
  );
}

/** 公開イベント一覧・グループに載せてよいイベント。 */
export function publicListableEventWhere() {
  return eq(events.visibility_status, "public");
}
