import { Hono } from "hono";
import type { EntryIndexResponse, EntryReservedSlot } from "@flamenode/contracts";
import type { AppEnv } from "../../../env.ts";
import { computeOnboardingState, loadPersonalContext } from "../context.ts";
import { compareEventsByUpcomingPriority, isAcceptingEntries, type EventStatusInput } from "./eventStatus.ts";
import { armOf, assertResponseBytes, ENTRY_PAGE_ROWS, loadArmRows, parseOffset } from "./rows.ts";
import { MAX_RESERVED_SLOTS } from "./sql.ts";

// CURRENT: app/(auth)/entry/page.tsx (logged-in branch). GET only: nothing is written.
// Events are paged (ENTRY_PAGE_ROWS per request, `?offset=`, `truncated` + `nextOffset`); the response is checked against 64 KiB.
// D1 (S2, 3 statements incl. the session lookup): context (terms + linked X + pending request) = 1,
// then ONE data statement: accepting events with their available-slot count + the user's reserved slots.
// Logged-out visitors get 401 (the SPA shows its login CTA); the public event list for them is a handoff.

interface EventRow extends EventStatusInput {
  id: string;
  title: string;
  slots_available: number;
}

interface SlotRow {
  id: string;
  event_id: string;
  video_id: string | null;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number | null;
  status: "reserved" | "submitted";
  event_title: string | null;
  event_entry_end_time: number | null;
}

export const personalEntryIndexRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const ctx = await loadPersonalContext(db, sessionUser, { pendingRequest: true });
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const state = computeOnboardingState({ user: ctx.user, linkedRows: ctx.linkedRows, pendingRequest: ctx.pendingRequest });

  const now = Math.floor(Date.now() / 1000);
  const offset = parseOffset(c.req.query("offset"));
  const activeX = ctx.user.active_x_user_id;
  const owner = activeX
    ? { sql: "slots.reserved_by_user_id = ? AND (slots.x_user_id = ? OR slots.x_user_id IS NULL)", params: [ctx.user.id, activeX] }
    : { sql: "slots.x_user_id IS NULL AND slots.reserved_by_user_id = ?", params: [ctx.user.id] };

  // events: CURRENT fetchActiveEvents (activeEventWhere) narrowed by the isAcceptingEntries entry-window predicate;
  // the JS filter below stays the authority. slots_available: CURRENT slotCounts (status = 'available' per event).
  const arms = await loadArmRows(
    db
      .prepare(
        `SELECT 'event' AS k, json_object('id', q.id, 'title', q.title, 'visibility_status', q.visibility_status,
            'start_time', q.start_time, 'end_time', q.end_time, 'entry_start_time', q.entry_start_time,
            'entry_end_time', q.entry_end_time, 'slots_available', q.slots_available) AS j
         FROM (
           SELECT events.id AS id, events.title AS title, events.visibility_status AS visibility_status,
             events.start_time AS start_time, events.end_time AS end_time,
             events.entry_start_time AS entry_start_time, events.entry_end_time AS entry_end_time,
             (SELECT COUNT(*) FROM slots WHERE slots.event_id = events.id AND slots.status = 'available') AS slots_available
           FROM events
           WHERE events.visibility_status = 'public'
             AND ((events.start_time IS NULL AND events.end_time IS NULL)
               OR (events.start_time IS NOT NULL AND events.end_time IS NOT NULL))
             AND (events.end_time IS NULL OR events.end_time > ?)
             AND (events.entry_start_time IS NOT NULL OR events.entry_end_time IS NOT NULL)
             AND (events.entry_start_time IS NULL OR events.entry_start_time <= ?)
             AND (events.entry_end_time IS NULL OR events.entry_end_time > ?)
           ORDER BY events.start_time DESC, events.id ASC
           LIMIT ${ENTRY_PAGE_ROWS} OFFSET ?) q
         UNION ALL
         SELECT 'slot' AS k, json_object('id', q.id, 'event_id', q.event_id, 'video_id', q.video_id,
            'slot_label', q.slot_label, 'start_time', q.start_time, 'sort_order', q.sort_order, 'status', q.status,
            'event_title', q.event_title, 'event_entry_end_time', q.event_entry_end_time) AS j
         FROM (
           SELECT slots.id AS id, slots.event_id AS event_id, slots.video_id AS video_id, slots.slot_label AS slot_label,
             slots.start_time AS start_time, slots.sort_order AS sort_order, slots.status AS status,
             events.title AS event_title, events.entry_end_time AS event_entry_end_time
           FROM slots
           LEFT JOIN events ON slots.event_id = events.id
           WHERE ${owner.sql} AND (slots.status = 'reserved' OR slots.status = 'submitted')
           ORDER BY slots.start_time, slots.sort_order, slots.id
           LIMIT ${MAX_RESERVED_SLOTS}) q`,
      )
      .bind(now, now, now, offset, ...owner.params),
  );

  const eventRows = armOf<EventRow>(arms, "event");
  // A full page may have more rows behind it (a page of exactly ENTRY_PAGE_ROWS reports truncated; the next page can be empty).
  const pageFull = eventRows.length >= ENTRY_PAGE_ROWS;
  const events = eventRows
    .sort((a, b) => compareEventsByUpcomingPriority(a, b, now))
    .filter((event) => isAcceptingEntries(event, now))
    .sort((a, b) => {
      const endDiff =
        (a.entry_end_time ?? Number.POSITIVE_INFINITY) - (b.entry_end_time ?? Number.POSITIVE_INFINITY);
      return endDiff || (a.start_time ?? 0) - (b.start_time ?? 0);
    })
    .map((event) => ({
      id: event.id,
      title: event.title,
      entry_end_time: event.entry_end_time ?? null,
      slots_available: Number(event.slots_available ?? 0),
    }));

  const reserved = armOf<SlotRow>(arms, "slot");
  reserved.sort((a, b) => {
    const aNeeds = !a.video_id && a.status === "reserved";
    const bNeeds = !b.video_id && b.status === "reserved";
    if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
    const deadlineDiff =
      (a.event_entry_end_time ?? Number.POSITIVE_INFINITY) - (b.event_entry_end_time ?? Number.POSITIVE_INFINITY);
    return deadlineDiff || (a.start_time ?? Number.POSITIVE_INFINITY) - (b.start_time ?? Number.POSITIVE_INFINITY);
  });
  const reservedSlots: EntryReservedSlot[] = reserved.map((slot) => ({
    id: slot.id,
    event_id: slot.event_id,
    video_id: slot.video_id ?? null,
    slot_label: slot.slot_label ?? null,
    start_time: slot.start_time ?? null,
    status: slot.status,
    event_title: slot.event_title ?? null,
    event_entry_end_time: slot.event_entry_end_time ?? null,
  }));

  // pageFull: this page was cut by the row bound; the next page starts after the rows READ (the JS filter only narrows).
  const body: EntryIndexResponse = {
    user: ctx.user,
    state,
    events,
    reservedSlots,
    truncated: pageFull,
    nextOffset: pageFull ? offset + eventRows.length : null,
  };
  assertResponseBytes(body);
  return c.json(body);
});
