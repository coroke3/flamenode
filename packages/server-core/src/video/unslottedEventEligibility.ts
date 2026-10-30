import { and, eq, isNotNull, lte, or, type SQL } from "drizzle-orm";
import { events } from "@flamenode/db/schema";
import { UnslottedEventSyncError } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";

/** UI、事前検証、保存時再検証で共有する正本条件。 */
export function unslottedEventEligibilityWhere(now: number): SQL {
  return and(
    eq(events.visibility_status, "public"),
    or(
      eq(events.allow_unslotted_posts, 1),
      and(isNotNull(events.end_time), lte(events.end_time, now)),
    ),
  )!;
}

export async function resolveUnslottedEventIdForNewVideo(
  db: ServerCoreDb,
  eventId: string | null,
  now = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!eventId) return null;
  const row = (
    await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), unslottedEventEligibilityWhere(now))!)
      .limit(1)
  )[0];
  if (!row) {
    throw new UnslottedEventSyncError("unslotted_event_not_allowed");
  }
  return row.id;
}

