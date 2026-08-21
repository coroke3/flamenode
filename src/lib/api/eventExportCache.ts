import "server-only";

import { getEnv } from "@/lib/cloudflare";

const EVENT_EXPORT_CACHE_VERSION = 5;
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

export function eventExportPayloadCacheKey(
  eventId: string,
  refreshMinutes: EventExportRefreshMinutes,
): string {
  return [
    "public-event-export",
    EVENT_EXPORT_CACHE_VERSION,
    encodeURIComponent(eventId),
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
    ...EVENT_EXPORT_REFRESH_MINUTES.map((refreshMinutes) =>
      eventExportPayloadCacheKey(eventId, refreshMinutes),
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
