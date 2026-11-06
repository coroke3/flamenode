// CURRENT: src/lib/utils/eventStatusCore.ts (computeEventStatus, isAcceptingEntries),
// src/lib/utils/eventOrdering.ts (compareEventsByUpcomingPriority), src/lib/manage/navigationEvents.ts (compareSidebarRows).
// Copied as-is and parity-tested against the real modules.

export interface EventStatusInput {
  visibility_status?: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
}

type EventDisplayStatus = "private" | "published" | "scheduled" | "active" | "ended";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export function computeEventStatus(ev: EventStatusInput, now: number = nowSeconds()): EventDisplayStatus {
  if (ev.visibility_status !== "public") return "private";
  if ((ev.start_time != null) !== (ev.end_time != null)) return "published";
  const effectiveEnd = ev.end_time ?? null;
  if (effectiveEnd != null && effectiveEnd <= now) return "ended";
  const effectiveStart = ev.start_time ?? null;
  if (effectiveStart != null && effectiveStart > now) return "scheduled";
  if (effectiveStart != null || effectiveEnd != null) return "active";
  return "published";
}

export function isAcceptingEntries(ev: EventStatusInput, now: number = nowSeconds()): boolean {
  const status = computeEventStatus(ev, now);
  if (status === "private" || status === "ended") return false;
  if (ev.entry_start_time == null && ev.entry_end_time == null) return false;
  if (ev.entry_start_time != null && now < ev.entry_start_time) return false;
  if (ev.entry_end_time != null && now >= ev.entry_end_time) return false;
  return true;
}

function eventStart(ev: EventStatusInput): number {
  return ev.start_time ?? ev.end_time ?? Number.POSITIVE_INFINITY;
}

function eventRecentTime(ev: EventStatusInput): number {
  return ev.end_time ?? ev.start_time ?? ev.entry_end_time ?? ev.entry_start_time ?? 0;
}

function priorityGroup(ev: EventStatusInput, now: number): number {
  const status = computeEventStatus(ev, now);
  if (status === "scheduled") return 0;
  if (isAcceptingEntries(ev, now)) return 1;
  if (status === "active") return 2;
  if (status === "published") return 3;
  if (status === "private") return 4;
  if (status === "ended") return 5;
  return 6;
}

export function compareEventsByUpcomingPriority<T extends EventStatusInput & { id?: string | null }>(
  a: T,
  b: T,
  now: number = nowSeconds(),
): number {
  const groupDiff = priorityGroup(a, now) - priorityGroup(b, now);
  if (groupDiff !== 0) return groupDiff;
  const group = priorityGroup(a, now);
  if (group <= 3) {
    const aStart = eventStart(a);
    const bStart = eventStart(b);
    // Both missing dates map to +Infinity; subtracting them would yield NaN.
    if (aStart !== bStart) return aStart < bStart ? -1 : 1;
  } else {
    const recentDiff = eventRecentTime(b) - eventRecentTime(a);
    if (recentDiff !== 0) return recentDiff;
  }
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

/** Sidebar order: start_time DESC, created_at DESC, id DESC with NULLs last (SQLite DESC). */
export function compareSidebarRows(
  left: { id: string; start_time: number | null; created_at: number | null },
  right: { id: string; start_time: number | null; created_at: number | null },
): number {
  const leftStart = left.start_time ?? Number.NEGATIVE_INFINITY;
  const rightStart = right.start_time ?? Number.NEGATIVE_INFINITY;
  if (leftStart !== rightStart) return rightStart > leftStart ? 1 : -1;
  const leftCreated = left.created_at ?? Number.NEGATIVE_INFINITY;
  const rightCreated = right.created_at ?? Number.NEGATIVE_INFINITY;
  if (leftCreated !== rightCreated) return rightCreated > leftCreated ? 1 : -1;
  const leftId = String(left.id);
  const rightId = String(right.id);
  return rightId < leftId ? -1 : rightId > leftId ? 1 : 0;
}
