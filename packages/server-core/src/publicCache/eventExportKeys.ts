/**
 * Pure event export payload cache identity contract (MIG-0632 U02a, D-14-2).
 *
 * Keep this version stable across Next and Hono. Increment it only when the
 * actual payload or snapshot selection changes, never as part of a migration.
 * This module does not read/write the Cache API and has no ambient bindings.
 */
const EVENT_EXPORT_CACHE_VERSION = 9;
export const EVENT_EXPORT_REFRESH_MINUTES = [15, 60, 360, 1440] as const;
export type EventExportCacheFormat = "v5" | "legacy";
export type EventExportRefreshMinutes = (typeof EVENT_EXPORT_REFRESH_MINUTES)[number];

export function isEventExportRefreshMinutes(value: number): value is EventExportRefreshMinutes {
  return EVENT_EXPORT_REFRESH_MINUTES.includes(value as EventExportRefreshMinutes);
}

export function eventExportPayloadCacheKey(
  eventId: string,
  format: EventExportCacheFormat,
  refreshMinutes: EventExportRefreshMinutes,
): string {
  return [
    "public-event-export",
    EVENT_EXPORT_CACHE_VERSION,
    encodeURIComponent(eventId),
    format,
    refreshMinutes,
  ].join(":");
}
