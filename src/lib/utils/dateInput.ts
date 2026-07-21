const jstDatetimeLocalFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Unix 秒を datetime-local 向け `YYYY-MM-DDTHH:mm` (Asia/Tokyo) に変換する。 */
export function formatJstDatetimeLocal(
  unixSec: number | null | undefined,
): string {
  if (unixSec == null || !Number.isFinite(unixSec)) return "";
  const date = new Date(unixSec * 1000);
  if (Number.isNaN(date.getTime())) return "";

  const parts = jstDatetimeLocalFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function parseJstDatetimeLocal(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }

  const [, y, mo, d, h, mi, sec = "0"] = m;
  return Math.floor(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h) - 9,
      Number(mi),
      Number(sec),
    ) / 1000,
  );
}
