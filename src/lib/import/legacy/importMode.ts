import type { EventVisibilityStatus } from "../../utils/eventStatusCore.ts";
import type { ImportMode } from "./types.ts";

/**
 * 旧データのイベントを取り込む際の公開設定を private / public へ正規化する。
 * 終了済みかどうかは日時から別途算出する。
 */
export function resolveImportedVisibility(
  mode: ImportMode,
  startTime: number | null,
  endTime: number | null,
  now: number,
): EventVisibilityStatus {
  if (mode === "draft") return "private";
  if (mode === "active_event" || mode === "archive") return "public";

  // preserve: 開始済み・終了済みのイベントは公開履歴として保持する。
  if (endTime != null && endTime < now) return "public";
  if (startTime != null && startTime <= now) return "public";
  return "private";
}
