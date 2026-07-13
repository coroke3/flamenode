import "server-only";

import { getEnv } from "@/lib/cloudflare";

export const EVENT_EXPORT_CACHE_VERSION = 4;
export const EVENT_EXPORT_ACCESS_CACHE_VERSION = 1;
export const EVENT_EXPORT_ACCESS_TTL_SECONDS = 60;
export const EVENT_EXPORT_REFRESH_MINUTES = [15, 60, 360, 1440] as const;

export type EventExportCacheFormat = "legacy" | "new";
export type EventExportRefreshMinutes =
  (typeof EVENT_EXPORT_REFRESH_MINUTES)[number];

export function isEventExportRefreshMinutes(
  value: number,
): value is EventExportRefreshMinutes {
  return EVENT_EXPORT_REFRESH_MINUTES.includes(
    value as EventExportRefreshMinutes,
  );
}

export function eventExportAccessCacheKey(eventId: string): string {
  return [
    "public-event-export-access",
    EVENT_EXPORT_ACCESS_CACHE_VERSION,
    encodeURIComponent(eventId),
  ].join(":");
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

function isKvNamespace(value: unknown): value is KVNamespace {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { get?: unknown }).get === "function" &&
    typeof (value as { put?: unknown }).put === "function" &&
    typeof (value as { delete?: unknown }).delete === "function"
  );
}

export function getEventExportKv(): KVNamespace | null {
  const kv = getEnv().KV;
  return isKvNamespace(kv) ? kv : null;
}

export async function invalidateEventExportCache(
  eventId: string,
): Promise<void> {
  const kv = getEventExportKv();
  if (!kv) return;

  const keys = [
    eventExportAccessCacheKey(eventId),
    ...(["legacy", "new"] as const).flatMap((format) =>
      EVENT_EXPORT_REFRESH_MINUTES.map((refreshMinutes) =>
        eventExportPayloadCacheKey(eventId, format, refreshMinutes),
      ),
    ),
  ];

  const results = await Promise.allSettled(keys.map((key) => kv.delete(key)));
  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length > 0) {
    console.warn("[event-export-api] cache invalidation partially failed", {
      eventId,
      failed: rejected.length,
    });
  }
}
