import type { EventVisibilityStatus } from "../../utils/eventStatusCore.ts";
import type { ImportMode } from "./types.ts";

/**
 * 旧データのイベントを取り込む際の visibility_status のみを解決する。
 * 旧互換フラグ (is_active/is_entry_open/is_archived) は一切出力しない。
 */
export function resolveImportedVisibility(
  mode: ImportMode,
  startTime: number | null,
  endTime: number | null,
  now: number,
): EventVisibilityStatus {
  if (mode === "draft") return "draft";
  if (mode === "active_event") return "public";
  if (mode === "archive") return "archived";

  // mode === "preserve": 日時から推定
  const end = endTime ?? null;
  const start = startTime ?? null;

  if (end && end < now) return "archived";
  if (start && start <= now && (!end || end >= now)) return "public";
  if (start && start > now) return "draft";
  return "archived";
}
