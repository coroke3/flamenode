import "server-only";

import { getEnv } from "@/lib/cloudflare";
import type { EventExportFormat } from "./eventExportPayload";

const EVENT_EXPORT_CACHE_VERSION = 4;
const EVENT_EXPORT_ACCESS_CACHE_VERSION = 1;
export const EVENT_EXPORT_ACCESS_TTL_SECONDS = 60;
export const EVENT_EXPORT_REFRESH_MINUTES = [15, 60, 360, 1440] as const;

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
  format: EventExportFormat,
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

export function getEventExportKv(): KVNamespace | null {
  return getEnv().KV ?? null;
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

  let failed = 0;
  for (let offset = 0; offset < keys.length; offset += 6) {
    const results = await Promise.allSettled(
      keys.slice(offset, offset + 6).map((key) => kv.delete(key)),
    );
    failed += results.filter((result) => result.status === "rejected").length;
  }
  if (failed > 0) {
    console.warn("[event-export-api] cache invalidation partially failed", {
      eventId,
      failed,
    });
  }
}
