// Port of CURRENT src/lib/utils/format.ts formatUnix / formatRelative (MIG-0734 U01-U02, D-17-6). Same output.
const fullFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

function toValidUnixSec(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

export function formatUnix(unixSec: unknown): string {
  const valid = toValidUnixSec(unixSec);
  if (valid == null) return "-";
  const date = new Date(valid * 1000);
  return Number.isNaN(date.getTime()) ? "-" : fullFormatter.format(date);
}

export function formatRelative(unixSec: unknown, nowMs: number = Date.now()): string {
  const valid = toValidUnixSec(unixSec);
  if (valid == null) return "";
  const diff = nowMs / 1000 - valid;
  if (diff < 60) return "今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}か月前`;
  return `${Math.floor(diff / 31536000)}年前`;
}
