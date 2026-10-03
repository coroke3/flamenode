import "server-only";

import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";

// Payload shape changed to include custom answers in both formats.
// Bump whenever the payload or snapshot selection changes so an older Cache API
// entry cannot keep serving a response built without custom answer values.
const EVENT_EXPORT_CACHE_VERSION = 9;
export const EVENT_EXPORT_REFRESH_MINUTES = [15, 60, 360, 1440] as const;

export type EventExportCacheFormat = "v5" | "legacy";
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

/**
 * scheduled snapshot は colo ごとの Cache API にだけ保存する（KV の書込/削除は使わない）。
 * 無効化は実行 colo のローカル best-effort。他 colo の entry は refresh 窓の終わり
 * （entry の stored_at 判定）まで残り得る。公開可否は毎 request の D1 で確認する。
 */
export async function invalidateEventExportCache(
  eventId: string,
): Promise<void> {
  const keys = (["v5", "legacy"] as const).flatMap((format) =>
    EVENT_EXPORT_REFRESH_MINUTES.map((refreshMinutes) =>
      eventExportPayloadCacheKey(eventId, format, refreshMinutes),
    ),
  );
  // deletePublicJsonCaches は Cache API 失敗を握りつぶす（mutation path を落とさない）。
  await deletePublicJsonCaches(keys);
}
