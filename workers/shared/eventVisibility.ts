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

export function isAcceptingEntries(args: {
  visibility_status: string | null | undefined;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  now: number;
}): boolean {
  const visibility = normalizeEventVisibility(args.visibility_status);
  if (visibility !== "public") return false;
  if (args.entry_start_time == null && args.entry_end_time == null) return false;
  if (args.entry_start_time != null && args.now < args.entry_start_time) return false;
  if (args.entry_end_time != null && args.now > args.entry_end_time) return false;
  return true;
}

/** 静的 JSON / API 互換用の算出フラグ（DB 列ではない）。 */
export function computedEventLegacyFlags(args: {
  visibility_status: string | null | undefined;
  entry_start_time: number | null;
  entry_end_time: number | null;
  now: number;
}): { is_active: number; is_entry_open: number; is_archived: number } {
  const visibility = normalizeEventVisibility(args.visibility_status);
  return {
    is_active: visibility === "public" ? 1 : 0,
    is_archived: visibility === "archived" ? 1 : 0,
    is_entry_open: isAcceptingEntries({
      visibility_status: args.visibility_status,
      start_time: null,
      end_time: null,
      entry_start_time: args.entry_start_time,
      entry_end_time: args.entry_end_time,
      now: args.now,
    })
      ? 1
      : 0,
  };
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
