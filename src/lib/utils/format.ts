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

const publicationDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function toValidUnixSec(value: unknown): number | null {
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

export function formatUnix(
  unixSec: unknown,
  opts: { dateOnly?: boolean; timeOnly?: boolean } = {},
): string {
  const validUnixSec = toValidUnixSec(unixSec);
  if (validUnixSec == null) return "-";
  const date = new Date(validUnixSec * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  if (opts.dateOnly) return dateOnlyFormatter.format(date);
  if (opts.timeOnly) return timeOnlyFormatter.format(date);
  return fullFormatter.format(date);
}

/** Event cards use a compact, explicit JST publication label. */
export function formatPublicationDateTime(unixSec: unknown): string {
  const validUnixSec = toValidUnixSec(unixSec);
  if (validUnixSec == null) return "公開日時未設定";
  const date = new Date(validUnixSec * 1000);
  if (Number.isNaN(date.getTime())) return "公開日時未設定";
  const parts = publicationDateTimeFormatter.formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${valueFor("month")}月${valueFor("day")}日 ${valueFor("hour")}:${valueFor("minute")} 公開`;
}

export function formatRelative(unixSec: unknown): string {
  const validUnixSec = toValidUnixSec(unixSec);
  if (validUnixSec == null) return "";
  const diff = Date.now() / 1000 - validUnixSec;
  if (diff < 60) return "今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}か月前`;
  return `${Math.floor(diff / 31536000)}年前`;
}

export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.floor(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.floor(n / 1000000)}M`;
}
