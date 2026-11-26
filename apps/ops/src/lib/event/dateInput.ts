// Port of CURRENT src/lib/utils/dateInput.ts (MIG-0721). Same output.
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
