import {
  computeEventStatus,
  isAcceptingEntries,
  isPointEvent,
  type EventStatusInput,
} from "./eventStatusCore.ts";
import { compareEventsByUpcomingPriority } from "./eventOrdering.ts";

export const MAX_HERO_EVENTS = 3;

export type HeroEventRow = EventStatusInput & {
  id: string;
  title: string;
  accent_color?: string | null;
  created_at?: number | null;
};

export function isHeroCandidate(event: HeroEventRow, now: number): boolean {
  if (isPointEvent(event)) return false;
  const status = computeEventStatus(event, now);
  return status !== "private" && status !== "ended";
}

function eventHeroRank(event: HeroEventRow, now: number): number {
  const status = computeEventStatus(event, now);
  if (status === "scheduled") {
    const start = event.start_time ?? event.end_time ?? Number.POSITIVE_INFINITY;
    return start - now;
  }
  const acceptingBonus = isAcceptingEntries(event, now) ? -10_000_000 : 0;
  const start =
    event.start_time ??
    event.end_time ??
    event.entry_start_time ??
    event.created_at ??
    now;
  if (start >= now) return acceptingBonus + (start - now);
  if (event.end_time != null && event.end_time >= now) {
    return acceptingBonus - 5_000_000;
  }
  return acceptingBonus + 100_000_000 + Math.abs(start - now);
}

/** HomeIntroBand と top.json slot_stats で共有するヒーローイベント選出。 */
export function pickHeroEvents(
  activeEvents: readonly HeroEventRow[],
  limit = MAX_HERO_EVENTS,
  now: number = Math.floor(Date.now() / 1000),
): HeroEventRow[] {
  return [...activeEvents]
    .filter((event) => isHeroCandidate(event, now))
    .sort((a, b) => {
      const priorityDiff = compareEventsByUpcomingPriority(a, b, now);
      if (priorityDiff !== 0) return priorityDiff;
      const rankDiff = eventHeroRank(a, now) - eventHeroRank(b, now);
      if (rankDiff !== 0) return rankDiff;
      const aStart = a.start_time ?? Number.POSITIVE_INFINITY;
      const bStart = b.start_time ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    })
    .slice(0, limit);
}
