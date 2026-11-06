// Ported from src/lib/utils/format.ts (formatUnix / formatRelative): always Asia/Tokyo with 2-digit
// fields and no seconds, so Manage dates do not shift with the browser time zone.
const fullFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const dateOnlyFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

function validUnixSec(value: unknown): number | null {
  // Match CURRENT format.ts: API values can arrive as numeric strings,
  // and callers may pass a Date. Reject empty or non-finite inputs.
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}
export function formatUnix(unixSec: unknown, opts: { dateOnly?: boolean } = {}): string {
  const sec = validUnixSec(unixSec);
  if (sec == null) return "-";
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  return (opts.dateOnly ? dateOnlyFormatter : fullFormatter).format(date);
}
export function formatRelative(unixSec: unknown, nowMs = Date.now()): string {
  const sec = validUnixSec(unixSec);
  if (sec == null) return "";
  const diff = nowMs / 1000 - sec;
  if (diff < 60) return "今";
  if (diff < 3600) return Math.floor(diff / 60) + "分前";
  if (diff < 86400) return Math.floor(diff / 3600) + "時間前";
  if (diff < 2592000) return Math.floor(diff / 86400) + "日前";
  if (diff < 31536000) return Math.floor(diff / 2592000) + "か月前";
  return Math.floor(diff / 31536000) + "年前";
}
