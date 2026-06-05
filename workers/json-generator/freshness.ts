export type EventFreshness = "active" | "ended" | "archived";

const ACTIVE_GRACE_AFTER_END_SEC = 86400;

export function resolveEventFreshness(
  event: {
    is_active: number;
    is_entry_open: number;
    is_archived: number;
    start_time: number | null;
    end_time: number | null;
  },
  now: number,
): EventFreshness {
  if (event.is_archived === 1) return "archived";
  if (event.is_active === 1 || event.is_entry_open === 1) return "active";
  const start = event.start_time ?? 0;
  const end = event.end_time ?? 0;
  if (start && end && now >= start && now <= end + ACTIVE_GRACE_AFTER_END_SEC) {
    return "active";
  }
  return "ended";
}

export function cacheControlForFreshness(freshness: EventFreshness): string {
  if (freshness === "active") {
    return "public, max-age=60, stale-while-revalidate=300";
  }
  return "public, max-age=3600, stale-while-revalidate=86400";
}
