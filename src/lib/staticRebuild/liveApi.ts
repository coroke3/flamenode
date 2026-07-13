import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { events, slots, videos, videoEvents } from "@/lib/db/schema";
import { resolveEventFreshness } from "./freshness";

const MAX_EVENT_ID_LEN = 128;
/** 1 イベントあたりの live slots 取得上限（D1 負荷・レスポンス肥大化の防止） */
const MAX_LIVE_SLOTS = 6000;

function normalizeEventId(eventId: string): string | null {
  const id = eventId.trim();
  return id && id.length <= MAX_EVENT_ID_LEN ? id : null;
}

async function eventExists(db: DB, eventId: string): Promise<boolean> {
  const row = (
    await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1)
  )[0];
  return Boolean(row);
}

export async function getLiveEventSummary(db: DB, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id) return null;

  const ev = (await db.select().from(events).where(eq(events.id, id)).limit(1))[0];
  if (!ev) return null;

  const now = Math.floor(Date.now() / 1000);
  const freshness = resolveEventFreshness(ev, now);
  const [slotRows, pendingReviewRows] = await Promise.all([
    db
      .select({
        status: slots.status,
        c: sql<number>`COUNT(*)`,
      })
      .from(slots)
      .where(eq(slots.event_id, id))
      .groupBy(slots.status),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videos)
      .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
      .where(
        and(
          eq(videoEvents.event_id, id),
          eq(videos.visibility_status, "pending"),
        )!,
      ),
  ]);

  let openSlots = 0;
  let reservedSlots = 0;
  let submitted = 0;
  for (const row of slotRows) {
    const count = Number(row.c ?? 0);
    if (row.status === "available") openSlots += count;
    if (row.status === "reserved") reservedSlots += count;
    if (row.status === "submitted") submitted += count;
  }

  return {
    event_id: id,
    freshness,
    open_slots: openSlots,
    reserved_slots: reservedSlots,
    submitted,
    pending_review: Number(pendingReviewRows[0]?.c ?? 0),
    generated_at: now,
  };
}

export async function getLiveEventSlots(db: DB, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id || !(await eventExists(db, id))) return null;

  const rows = await db
    .select({
      id: slots.id,
      status: slots.status,
      video_id: slots.video_id,
      display_name: slots.display_name,
    })
    .from(slots)
    .where(eq(slots.event_id, id))
    .orderBy(slots.start_time)
    .limit(MAX_LIVE_SLOTS);

  return {
    event_id: id,
    slots: rows,
    truncated: rows.length >= MAX_LIVE_SLOTS,
    generated_at: Math.floor(Date.now() / 1000),
  };
}

export async function getLiveEventSubmissions(db: DB, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id || !(await eventExists(db, id))) return null;

  const rows = await db
    .select({
      video_id: videos.id,
      title: videos.title,
      creator_display_name: videos.creator_display_name,
      updated_at: videos.updated_at,
    })
    .from(videos)
    .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
    .where(
      and(
        eq(videoEvents.event_id, id),
        eq(videos.visibility_status, "public"),
      )!,
    )
    .orderBy(sql`${videos.updated_at} DESC`)
    .limit(50);

  return {
    event_id: id,
    submissions: rows,
    generated_at: Math.floor(Date.now() / 1000),
  };
}
