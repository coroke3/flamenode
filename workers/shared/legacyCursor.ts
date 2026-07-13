/**
 * 旧Worker cursorの互換読取。
 * 現行Workerはcursorを使用しないが、既存テスト・移行データ向けの返値を維持する。
 */
export function normalizeLegacyVideoCursor(value: string | null): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { last_video_id?: unknown };
    return typeof parsed.last_video_id === "string"
      ? parsed.last_video_id.trim()
      : "";
  } catch {
    return "";
  }
}
