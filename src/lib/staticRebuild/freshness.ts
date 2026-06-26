import type { EventFreshness } from "./types";

/** 終了後も live 寄りに扱う猶予（秒） */
export const ACTIVE_GRACE_AFTER_END_SEC = 86400;

export type EventFreshnessInput = {
  is_active: number;
  /** Legacy DB flag; freshness no longer depends on manual entry status. */
  is_entry_open: number;
  is_archived: number;
  start_time: number | null;
  end_time: number | null;
};

/**
 * イベント鮮度。`frozen` は追加しない。
 * Active X とは無関係（静的 JSON の Cache-Control や live API 分岐用）。
 */
export function resolveEventFreshness(
  event: EventFreshnessInput,
  now: number,
): EventFreshness {
  if (event.is_archived === 1) return "archived";
  if (event.is_active === 1) return "active";

  const start = event.start_time ?? 0;
  const end = event.end_time ?? 0;

  if (start && end && now >= start && now <= end + ACTIVE_GRACE_AFTER_END_SEC) {
    return "active";
  }

  return "ended";
}

export function cacheControlForFreshness(
  freshness: EventFreshness,
): string {
  if (freshness === "active") {
    return "public, max-age=60, stale-while-revalidate=300";
  }
  return "public, max-age=3600, stale-while-revalidate=86400";
}
