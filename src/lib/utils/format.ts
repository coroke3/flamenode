/** 日時文字列・各種フォーマッタ。 */

const fullFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const dateOnlyFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeOnlyFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});

/** UNIX 秒 (number) を JST 表記の文字列にする。 */
export function formatUnix(unixSec: number | null | undefined, opts: { dateOnly?: boolean; timeOnly?: boolean } = {}): string {
  if (unixSec == null) return "—";
  const d = new Date(unixSec * 1000);
  if (opts.dateOnly) return dateOnlyFormatter.format(d);
  if (opts.timeOnly) return timeOnlyFormatter.format(d);
  return fullFormatter.format(d);
}

/** 「3 日前」「1 時間前」風の相対表記 (簡易版)。 */
export function formatRelative(unixSec: number | null | undefined): string {
  if (unixSec == null) return "";
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 60) return "今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}か月前`;
  return `${Math.floor(diff / 31536000)}年前`;
}

/** 秒 → "1:23:45" / "12:34" 表記。 */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 数値を 1.2k / 12k / 1.2M 形式で省略する。 */
export function formatCount(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.floor(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.floor(n / 1000000)}M`;
}
