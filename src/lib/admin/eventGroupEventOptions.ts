import "server-only";

import { and, asc, desc, eq, gt, lt, notExists, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { eventGroupEvents, events } from "@/lib/db/schema";

export const EVENT_GROUP_EVENT_PAGE_SIZE = 80;

export type EventGroupEventOption = {
  id: string;
  title: string;
  start_time: number | null;
};

export type EventGroupEventOptionsPage = {
  options: EventGroupEventOption[];
  nextCursor: string | null;
};

type EventGroupEventCursor = { updatedAt: number; id: string };

function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function likeTitle(query: string) {
  return sql`${events.title} LIKE ${`%${escapeLikeTerm(query)}%`} ESCAPE '\\'`;
}

function parseCursor(raw: string | null | undefined): EventGroupEventCursor | null {
  if (!raw) return null;
  if (raw.length > 200) throw new Error("event_group_cursor_invalid");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { updatedAt?: unknown }).updatedAt !== "number" ||
      !Number.isSafeInteger((parsed as { updatedAt: number }).updatedAt) ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      !(parsed as { id: string }).id
    ) {
      throw new Error("event_group_cursor_invalid");
    }
    return parsed as EventGroupEventCursor;
  } catch {
    throw new Error("event_group_cursor_invalid");
  }
}

export async function queryEventGroupEventOptions(
  db: DB,
  args: {
    groupId: string;
    query?: string | null;
    cursor?: string | null;
  },
): Promise<EventGroupEventOptionsPage> {
  const groupId = args.groupId.trim();
  if (!groupId) throw new Error("event_group_id_required");
  const query = (args.query ?? "").trim();
  if (query.length > 64) throw new Error("event_group_query_too_long");
  const cursor = parseCursor(args.cursor);
  const conditions = [
    notExists(
      db
        .select({ event_id: eventGroupEvents.event_id })
        .from(eventGroupEvents)
        .where(
          and(
            eq(eventGroupEvents.event_group_id, groupId),
            eq(eventGroupEvents.event_id, events.id),
          ),
        ),
    ),
  ];
  if (query) conditions.push(likeTitle(query));
  if (cursor) {
    conditions.push(
      or(
        lt(events.updated_at, cursor.updatedAt),
        and(
          eq(events.updated_at, cursor.updatedAt),
          gt(events.id, cursor.id),
        ),
      )!,
    );
  }
  const rows = await db
    .select({ id: events.id, title: events.title, start_time: events.start_time, updated_at: events.updated_at })
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.updated_at), asc(events.id))
    .limit(EVENT_GROUP_EVENT_PAGE_SIZE + 1);
  const hasMore = rows.length > EVENT_GROUP_EVENT_PAGE_SIZE;
  const page = rows.slice(0, EVENT_GROUP_EVENT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    options: page.map(({ id, title, start_time }) => ({ id, title, start_time })),
    nextCursor:
      hasMore && last
        ? JSON.stringify({ updatedAt: last.updated_at, id: last.id })
        : null,
  };
}
