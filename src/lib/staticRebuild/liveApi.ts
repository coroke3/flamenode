import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { events, slots, videos, videoEvents } from "@/lib/db/schema";
import type { EventFreshness } from "./types";
import { getEventVisibility } from "#utils/event-status-core";
import { projectLiveSlotIdentity } from "./liveApiCore";

const ACTIVE_GRACE_AFTER_END_SEC = 86400;

function resolveEventFreshness(
  event: {
    visibility_status?: string | null;
    start_time: number | null;
    end_time: number | null;
  },
  now: number,
): EventFreshness {
  const visibility = getEventVisibility(event);
  if (visibility !== "public") return "ended";
  const end = event.end_time ?? 0;
  return end && now > end + ACTIVE_GRACE_AFTER_END_SEC ? "ended" : "active";
}

const MAX_EVENT_ID_LEN = 128;
/** 1 イベントあたりの live slots 取得上限（D1 負荷・レスポンス肥大化の防止） */
const MAX_LIVE_SLOTS = 6000;

function normalizeEventId(eventId: string): string | null {
  const id = eventId.trim();
  return id && id.length <= MAX_EVENT_ID_LEN ? id : null;
}

export async function getLiveEventSummary(db: DB, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id) return null;

  const rows = await db
    .select({
      visibility_status: events.visibility_status,
      start_time: events.start_time,
      end_time: events.end_time,
      open_slots: sql<number>`(
        SELECT COUNT(*) FROM slots AS live_slots
        WHERE live_slots.event_id = ${events.id}
          AND live_slots.status = 'available'
      )`,
      reserved_slots: sql<number>`(
        SELECT COUNT(*) FROM slots AS live_slots
        WHERE live_slots.event_id = ${events.id}
          AND live_slots.status = 'reserved'
      )`,
      submitted: sql<number>`(
        SELECT COUNT(*) FROM slots AS live_slots
        WHERE live_slots.event_id = ${events.id}
          AND live_slots.status = 'submitted'
      )`,
    })
    .from(events)
    .where(and(eq(events.id, id), eq(events.visibility_status, "public")))
    .limit(1);
  const event = rows[0];
  if (!event) return null;

  const now = Math.floor(Date.now() / 1000);
  return {
    event_id: id,
    freshness: resolveEventFreshness(event, now),
    open_slots: Number(event.open_slots ?? 0),
    reserved_slots: Number(event.reserved_slots ?? 0),
    submitted: Number(event.submitted ?? 0),
    generated_at: now,
  };
}

export async function getLiveEventSlots(db: DB, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id) return null;

  const rows = await db
    .select({
      slot_visibility_mode: events.slot_visibility_mode,
      id: slots.id,
      status: slots.status,
      public_video_id: videos.id,
      display_name: slots.display_name,
    })
    .from(events)
    .leftJoin(slots, eq(slots.event_id, events.id))
    .leftJoin(
      videos,
      and(
        eq(videos.id, slots.video_id),
        eq(videos.visibility_status, "public"),
      )!,
    )
    .where(and(eq(events.id, id), eq(events.visibility_status, "public")))
    .orderBy(slots.start_time)
    .limit(MAX_LIVE_SLOTS);
  if (rows.length === 0) return null;

  const slotRows = rows.flatMap((row) =>
    row.id == null
      ? []
      : [
          {
            id: row.id,
            status: row.status!,
            ...projectLiveSlotIdentity(
              row.slot_visibility_mode,
              row.public_video_id,
              row.display_name,
            ),
          },
        ],
  );

  return {
    event_id: id,
    slots: slotRows,
    truncated: slotRows.length >= MAX_LIVE_SLOTS,
    generated_at: Math.floor(Date.now() / 1000),
  };
}

export async function getLiveEventSubmissions(db: DB, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id) return null;

  const rows = await db
    .select({
      video_id: videos.id,
      title: videos.title,
      creator_display_name: videos.creator_display_name,
      updated_at: videos.updated_at,
    })
    .from(events)
    .leftJoin(
      videoEvents,
      and(
        eq(videoEvents.event_id, events.id),
        sql`EXISTS (
          SELECT 1 FROM videos AS public_videos
          WHERE public_videos.id = ${videoEvents.video_id}
            AND public_videos.visibility_status = 'public'
        )`,
      )!,
    )
    .leftJoin(videos, eq(videos.id, videoEvents.video_id))
    .where(and(eq(events.id, id), eq(events.visibility_status, "public")))
    .orderBy(sql`${videos.updated_at} DESC`)
    .limit(50);
  if (rows.length === 0) return null;

  const submissions = rows.flatMap((row) =>
    row.video_id == null
      ? []
      : [
          {
            video_id: row.video_id,
            title: row.title!,
            creator_display_name: row.creator_display_name,
            updated_at: row.updated_at!,
          },
        ],
  );

  return {
    event_id: id,
    submissions,
    generated_at: Math.floor(Date.now() / 1000),
  };
}
