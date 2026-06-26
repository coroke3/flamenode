import {
  computeEventStatus,
  isAcceptingEntries,
  type EventStatusInput,
} from "@/lib/utils/eventStatusCore";

const FAR_FUTURE = Number.POSITIVE_INFINITY;

function eventStart(ev: EventStatusInput): number {
  return ev.start_time ?? ev.end_time ?? FAR_FUTURE;
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
  if (status === "draft") return 4;
  if (status === "ended") return 5;
  return 6;
}

export function compareEventsByUpcomingPriority<
  T extends EventStatusInput & { id?: string | null },
>(
  a: T,
  b: T,
  now: number = Math.floor(Date.now() / 1000),
): number {
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
