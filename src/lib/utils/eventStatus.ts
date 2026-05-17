import { and, eq, gt, isNull, or } from "drizzle-orm";
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
  return and(
    eq(events.is_active, 1),
    eq(events.is_archived, 0),
    or(isNull(events.end_time), gt(events.end_time, now))!,
  );
}
