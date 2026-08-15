import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { events } from "@/lib/db/schema";

export type ManageEventRender = {
  id: string;
  title: string;
  accent_color: string | null;
  slot_part_gap_minutes: number | null;
};

/** Request-local projection shared by manage pages and generateMetadata. */
async function loadManageEventForRender(
  eventId: string,
): Promise<ManageEventRender | null> {
  const db = getDatabase();
  if (!db) return null;

  const row = (
    await db
      .select({
        id: events.id,
        title: events.title,
        accent_color: events.accent_color,
        slot_part_gap_minutes: events.slot_part_gap_minutes,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1)
  )[0];
  return row ?? null;
}

// React cache is request-local here; do not replace it with a persistent
// Next/KV/R2 cache because event titles and display settings are mutable.
export const getManageEventForRender = cache(loadManageEventForRender);
