import { parseJstDatetimeLocalStrict } from "@flamenode/domain/datetime";

export {
  parseJstDatetimeLocalStrict,
  type JstDatetimeLocalParseResult,
} from "@flamenode/domain/datetime";

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
  const parsed = parseJstDatetimeLocalStrict(raw);
  return parsed.ok ? parsed.value : null;
}
