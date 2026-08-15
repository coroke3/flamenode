import "server-only";

import { cache } from "react";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { events, videoEvents, videos } from "@/lib/db/schema";
import { getManageAuthorizationSnapshot } from "@/lib/auth/manageAuthorization";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";

/**
 * The small event projection needed by the manage sidebar and dashboard.
 * Keep this separate from the full events row: event descriptions/settings are
 * not needed by either navigation surface.
 */
export type ManageNavigationEvent = {
  id: string;
  title: string;
  accent_color: string | null;
  visibility_status: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  pending_review_count: number;
};

export type ManageNavigationSnapshot = {
  /** Sidebar order: start_time DESC, created_at DESC, id DESC (legacy query order). */
  events: ManageNavigationEvent[];
  /** /manage dashboard order: status/upcoming priority (legacy page order). */
  dashboardEvents: ManageNavigationEvent[];
  pendingByEvent: Map<string, number>;
};

// Keep headroom for the visibility/status predicate and future fixed binds.
const D1_SAFE_EVENT_ID_CHUNK_SIZE = 80;

function chunkEventIds(ids: readonly string[]): string[][] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += D1_SAFE_EVENT_ID_CHUNK_SIZE) {
    chunks.push(unique.slice(index, index + D1_SAFE_EVENT_ID_CHUNK_SIZE));
  }
  return chunks;
}

const eventSelect = {
  id: events.id,
  title: events.title,
  accent_color: events.accent_color,
  visibility_status: events.visibility_status,
  start_time: events.start_time,
  end_time: events.end_time,
  entry_start_time: events.entry_start_time,
  entry_end_time: events.entry_end_time,
  // Kept internal to reproduce the sidebar's historical SQL ordering after
  // non-admin event ids are read in bind-safe chunks.
  created_at: events.created_at,
} as const;

type ManageNavigationEventRow = Omit<ManageNavigationEvent, "pending_review_count"> & {
  created_at: number | null;
};

async function loadEventRows(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  eventIds: readonly string[],
  isAdmin: boolean,
): Promise<ManageNavigationEventRow[]> {
  if (!isAdmin && eventIds.length === 0) return [];

  if (isAdmin) {
    return db
      .select(eventSelect)
      .from(events)
      .orderBy(desc(events.start_time), desc(events.created_at), desc(events.id));
  }

  const rows: ManageNavigationEventRow[] = [];
  for (const chunk of chunkEventIds(eventIds)) {
    const chunkRows = await db
      .select(eventSelect)
      .from(events)
      .where(inArray(events.id, chunk))
      .orderBy(desc(events.start_time), desc(events.created_at), desc(events.id));
    rows.push(...chunkRows);
  }
  return rows;
}

function compareSidebarRows(
  left: ManageNavigationEventRow,
  right: ManageNavigationEventRow,
): number {
  // SQLite DESC places NULL values after non-NULL values.  Mapping NULL to
  // negative infinity reproduces that order without adding a client query.
  const startDiff =
    (right.start_time ?? Number.NEGATIVE_INFINITY) -
    (left.start_time ?? Number.NEGATIVE_INFINITY);
  if (startDiff !== 0) return startDiff;
  const createdDiff =
    (right.created_at ?? Number.NEGATIVE_INFINITY) -
    (left.created_at ?? Number.NEGATIVE_INFINITY);
  if (createdDiff !== 0) return createdDiff;
  // IDs are ASCII identifiers in the canonical schema. Relational string
  // comparison keeps the same binary tie-break as SQLite ORDER BY id DESC;
  // localeCompare could vary by the server locale.
  const leftId = String(left.id);
  const rightId = String(right.id);
  return rightId < leftId ? -1 : rightId > leftId ? 1 : 0;
}

async function loadPendingByEvent(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  eventIds: readonly string[],
): Promise<Map<string, number>> {
  const pendingByEvent = new Map<string, number>();
  for (const chunk of chunkEventIds(eventIds)) {
    const rows = await db
      .select({
        event_id: videoEvents.event_id,
        c: sql<number>`COUNT(*)`,
      })
      .from(videos)
      .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
      .where(
        and(
          inArray(videoEvents.event_id, chunk),
          eq(videos.visibility_status, "pending"),
        )!,
      )
      .groupBy(videoEvents.event_id);
    for (const row of rows) {
      pendingByEvent.set(row.event_id, Number(row.c ?? 0));
    }
  }
  return pendingByEvent;
}

/**
 * Load the request-local event projection used by /manage navigation.
 * Authorization is resolved by the request-local snapshot; event rows and
 * pending counts remain fresh D1 reads for every new request.
 */
async function loadManageNavigationSnapshot(
  authUserId: string,
  role: string | null,
): Promise<ManageNavigationSnapshot> {
  const db = getDatabase();
  if (!db) return { events: [], dashboardEvents: [], pendingByEvent: new Map() };

  const authorization = await getManageAuthorizationSnapshot(authUserId, role);
  const rows = await loadEventRows(
    db,
    authorization.manageableEventIds,
    authorization.isAdmin,
  );
  const sidebarRows = [...rows].sort(compareSidebarRows);
  const dashboardRows = [...sidebarRows].sort(compareEventsByUpcomingPriority);
  const eventIds = sidebarRows.map((row) => row.id);
  const pendingByEvent = await loadPendingByEvent(db, eventIds);
  const toNavigationEvent = (row: ManageNavigationEventRow): ManageNavigationEvent => {
    // Do not expose created_at: it is only an ordering implementation detail.
    const { created_at: _createdAt, ...event } = row;
    return {
      ...event,
      pending_review_count: pendingByEvent.get(row.id) ?? 0,
    };
  };
  const navigationEvents = sidebarRows.map(toNavigationEvent);
  const dashboardEvents = dashboardRows.map(toNavigationEvent);
  return { events: navigationEvents, dashboardEvents, pendingByEvent };
}

/** Same-request memoization only; no Data Cache/KV/TTL persistence. */
export const getManageNavigationSnapshot = cache(loadManageNavigationSnapshot);
