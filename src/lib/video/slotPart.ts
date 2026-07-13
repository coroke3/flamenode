import { and, eq, ne, sql } from "drizzle-orm";
import { events as eventsTable, slots, videos } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { buildSlotParts } from "@/lib/utils/slotGroupingCore";
import { parseEventPartsJson } from "@/lib/video/parseEventIds";

export async function resolvePartFromSlot(
  db: DB,
  slotRow: typeof slots.$inferSelect,
): Promise<string | null> {
  const eventRow = (
    await db
      .select({
        parts_json: eventsTable.parts_json,
        slot_part_gap_minutes: eventsTable.slot_part_gap_minutes,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, slotRow.event_id))
      .limit(1)
  )[0];
  const configuredParts = parseEventPartsJson(eventRow?.parts_json);
  if (configuredParts.length === 0) return null;

  const eventSlots = await db
    .select({
      id: slots.id,
      start_time: slots.start_time,
      slot_kind: slots.slot_kind,
      sort_order: slots.sort_order,
    })
    .from(slots)
    .where(eq(slots.event_id, slotRow.event_id));
  const slotPart = buildSlotParts(
    eventSlots,
    (eventRow?.slot_part_gap_minutes ?? 15) * 60,
  ).find((part) => part.rows.some((row) => row.id === slotRow.id));

  return slotPart ? (configuredParts[slotPart.index - 1] ?? null) : null;
}

export async function checkYoutubeVideoDuplicate(
  db: DB,
  youtubeId: string,
  excludeVideoId?: string,
): Promise<boolean> {
  const row = (
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(
          eq(videos.youtube_video_id, youtubeId),
          sql`${videos.visibility_status} NOT IN ('archived', 'voided')`,
          excludeVideoId ? ne(videos.id, excludeVideoId) : undefined,
        )!,
      )
      .limit(1)
  )[0];
  return Boolean(row);
}
