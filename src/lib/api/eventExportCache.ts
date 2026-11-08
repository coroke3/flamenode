import "server-only";

import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";
import {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
} from "@flamenode/server-core/publicCache/eventExportKeys";

// Compatibility bridge (MIG-0632 U02a, D-14-2): keep legacy exports and
// invalidation side-effects, but share pure cache identity with the Hono port.
export {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
  isEventExportRefreshMinutes,
} from "@flamenode/server-core/publicCache/eventExportKeys";
export type {
  EventExportCacheFormat,
  EventExportRefreshMinutes,
} from "@flamenode/server-core/publicCache/eventExportKeys";

/**
 * scheduled snapshot は colo ごとの Cache API にだけ保存する（KV の書込/削除は使わない）。
 * 無効化は実行 colo のローカル best-effort。他 colo の entry は refresh 窓の終わり
 * （entry の stored_at 判定）まで残り得る。公開可否は毎 request の D1 で確認する。
 */
export async function invalidateEventExportCache(
  eventId: string,
): Promise<void> {
  // deletePublicJsonCaches は Cache API 失敗を握りつぶす（mutation path を落とさない）。
  await deletePublicJsonCaches(eventExportPayloadCacheKeys(eventId));
}

function eventExportPayloadCacheKeys(eventId: string): string[] {
  return (["v5", "legacy"] as const).flatMap((format) =>
    EVENT_EXPORT_REFRESH_MINUTES.map((refreshMinutes) =>
      eventExportPayloadCacheKey(eventId, format, refreshMinutes),
    ),
  );
}

/**
 * 作品公開状態の変更後に関連イベントの payload cache をまとめて無効化する。
 * 上限: 呼び出し側の eventIds は MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS(8) 以下、
 * 1 event あたり 2 format x 4 refresh = 8 key、よって Cache API delete は最大 64 回。
 * KV / D1 / R2 は使わないため無料枠の課金対象操作は 0。
 */
export async function invalidateEventExportCaches(
  eventIds: readonly string[],
): Promise<void> {
  const keys = [...new Set(eventIds)]
    .filter(Boolean)
    .flatMap(eventExportPayloadCacheKeys);
  if (keys.length > 0) await deletePublicJsonCaches(keys);
}
