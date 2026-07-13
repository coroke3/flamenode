/** Workers 向け: visibility_status から公開状態を解釈する（DB 旧列非依存）。 */

export type EventVisibilityStatus = "draft" | "private" | "public" | "archived";

export function normalizeEventVisibility(
  raw: string | null | undefined,
): EventVisibilityStatus {
  if (
    raw === "draft" ||
    raw === "private" ||
    raw === "public" ||
    raw === "archived"
  ) {
    return raw;
  }
  return "draft";
}

export type EventFreshness = "active" | "ended" | "archived";

const ACTIVE_GRACE_AFTER_END_SEC = 86400;

export function resolveEventFreshness(
  event: {
    visibility_status: string | null | undefined;
    start_time: number | null;
    end_time: number | null;
  },
  now: number,
): EventFreshness {
  const visibility = normalizeEventVisibility(event.visibility_status);
  if (visibility === "archived") return "archived";
  if (visibility === "public") return "active";
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
