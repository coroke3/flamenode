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
    })
    .from(events)
    .where(and(eq(events.id, id), eq(events.visibility_status, "public")))
    .limit(1);
  const event = rows[0];
  if (!event) return null;

  // 旧実装は同一 event_id を3回range scanするcorrelated COUNTサブクエリを
  // 埋め込んでいた。slotsを1回だけ走査し、status別の集計を1 passで行う
  // （3N→N rows_read、5秒ポーリングのホットパス）。
  // statusはavailable/reserved/submittedの3値で網羅済みのため、
  // 3列の合計は该eventのslots件数と一致する（COUNT(CASE ...) はNULLを数えない）。
  const counts = await db
    .select({
      open_slots: sql<number>`COUNT(CASE WHEN ${slots.status} = 'available' THEN 1 END)`,
      reserved_slots: sql<number>`COUNT(CASE WHEN ${slots.status} = 'reserved' THEN 1 END)`,
      submitted: sql<number>`COUNT(CASE WHEN ${slots.status} = 'submitted' THEN 1 END)`,
    })
    .from(slots)
    .where(eq(slots.event_id, id))
    .limit(1);
  const countRow = counts[0];

  const now = Math.floor(Date.now() / 1000);
  return {
    event_id: id,
    freshness: resolveEventFreshness(event, now),
    open_slots: Number(countRow?.open_slots ?? 0),
    reserved_slots: Number(countRow?.reserved_slots ?? 0),
    submitted: Number(countRow?.submitted ?? 0),
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
    .leftJoin(videoEvents, eq(videoEvents.event_id, events.id))
    .leftJoin(
      videos,
      and(
        eq(videos.id, videoEvents.video_id),
        eq(videos.visibility_status, "public"),
      ),
    )
    .where(and(eq(events.id, id), eq(events.visibility_status, "public")))
    .orderBy(sql`${videos.updated_at} DESC`)
    .limit(50);
  if (rows.length === 0) return null;

  // public 以外の提出・孤児 video は video_id がnullのまま残り、ここで落とす。
  // events行はpublicイベントが存在すれば必ず返るため、提出0件でも200＋空配列を保持する。
  // ORDER BY DESC ではSQLiteのNULLが最後になるため、LIMIT 50は常に最新の
  // public提出50件に収束する（旧実装と同一の選択）。
  const submissions = rows.flatMap((row) =>
    row.video_id == null
      ? []
      : [
          {
            video_id: row.video_id,
            title: row.title!,
            creator_display_name: row.creator_display_name!,
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
