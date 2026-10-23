// CURRENT: src/lib/utils/eventStatusCore.ts (computeEventStatus, isAcceptingEntries) and
// src/lib/utils/eventOrdering.ts (compareEventsByUpcomingPriority). Copied (pure functions); parity-tested
// against the real modules in apps/api/test/personalEntry.parity.test.mjs. Domain-package candidate.

export interface EventStatusInput {
  id?: string | null;
  visibility_status?: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
}

type EventDisplayStatus = "private" | "published" | "scheduled" | "active" | "ended";

function isPublic(ev: EventStatusInput): boolean {
  return ev.visibility_status === "public";
}

function isPointEvent(ev: EventStatusInput): boolean {
  return (ev.start_time != null) !== (ev.end_time != null);
}

export function computeEventStatus(ev: EventStatusInput, now: number): EventDisplayStatus {
  if (!isPublic(ev)) return "private";
  if (isPointEvent(ev)) return "published";
  const end = ev.end_time ?? null;
  if (end != null && end <= now) return "ended";
  const start = ev.start_time ?? null;
  if (start != null && start > now) return "scheduled";
  if (start != null || end != null) return "active";
  return "published";
}

export function isAcceptingEntries(ev: EventStatusInput, now: number): boolean {
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

export function compareEventsByUpcomingPriority(a: EventStatusInput, b: EventStatusInput, now: number): number {
  const groupDiff = priorityGroup(a, now) - priorityGroup(b, now);
  if (groupDiff !== 0) return groupDiff;
  const group = priorityGroup(a, now);
  if (group <= 3) {
    const startDiff = eventStart(a) - eventStart(b);
    if (startDiff !== 0) return startDiff;
  } else {
    const recentDiff = eventRecentTime(b) - eventRecentTime(a);
    if (recentDiff !== 0) return recentDiff;
  }
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}
