import "server-only";

import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import {
  videos as videosTable,
  videoEvents as videoEventsTable,
} from "@/lib/db/schema";

/** Event-scoped pending review count (videos JOIN video_events, visibility_status = pending). */
export async function countPendingReviewVideos(
  db: DB,
  eventId: string,
): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(videosTable)
    .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
    .where(
      and(
        eq(videoEventsTable.event_id, eventId),
        eq(videosTable.visibility_status, "pending"),
      )!,
    );
  return Number(rows[0]?.c ?? 0);
}

/** Same-request dedupe for event pending review count. */
export const getEventPendingReviewVideoCount = cache(
  async (eventId: string): Promise<number> => {
    const db = getDatabase();
    if (!db) return 0;
    return countPendingReviewVideos(db, eventId);
  },
);
