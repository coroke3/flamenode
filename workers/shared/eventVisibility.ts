/** Workers 向け: イベント公開設定と日時由来の鮮度を解釈する。 */

import {
  staticR2CacheControl,
  STATIC_R2_MAX_AGE_SEC,
} from "./staticR2CacheControl.ts";

export type EventVisibilityStatus = "private" | "public";

export function normalizeEventVisibility(
  raw: string | null | undefined,
): EventVisibilityStatus {
  return raw === "public" ? "public" : "private";
}

export type EventFreshness = "active" | "ended";

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
  if (visibility !== "public") return "ended";
  const end = event.end_time ?? 0;
  return end && now > end + ACTIVE_GRACE_AFTER_END_SEC ? "ended" : "active";
}

export function cacheControlForFreshness(freshness: EventFreshness): string {
  if (freshness === "active") {
    return staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.eventDetail);
  }
  return staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.rules);
}
