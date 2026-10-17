import { z } from "zod";
import type { ParsedAnnouncementDates } from "./types.ts";

export const announcementInputSchema = z.object({
  id: z.string().trim().optional(),
  base_updated_at: z.coerce.number().int().nonnegative().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  severity: z.enum(["info", "warning", "danger"]).default("info"),
  target_audience: z.enum(["all", "creators", "admins"]).default("all"),
  is_published: z.coerce.number().int().min(0).max(1).default(0),
  publish_at: z.string().optional().nullable(),
  expire_at: z.string().optional().nullable(),
});

export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export type JstDatetimeLocalParseResult =
  | { ok: true; value: number | null }
  | { ok: false; reason: "invalid_datetime" };

/**
 * Parse an HTML datetime-local value as Asia/Tokyo without Date.parse
 * fallbacks or Date.UTC date normalisation. Empty input is valid and maps
 * to null; a non-empty malformed/out-of-range value is rejected.
 */
export function parseJstDatetimeLocalStrict(
  raw: string | null | undefined,
): JstDatetimeLocalParseResult {
  if (raw == null || raw.trim() === "") return { ok: true, value: null };
  const s = raw.trim();
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return { ok: false, reason: "invalid_datetime" };

  const [, yRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw = "0"] = m;
  const year = Number(yRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  if (
    year < 100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return { ok: false, reason: "invalid_datetime" };
  }

  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > dim) return { ok: false, reason: "invalid_datetime" };

  // Asia/Tokyo is UTC+9 with no DST.
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second) - 9 * 3600 * 1000;
  return { ok: true, value: Math.floor(utcMs / 1000) };
}

export function parseAnnouncementDates(
  publishAt: string | null | undefined,
  expireAt: string | null | undefined,
):
  | { ok: true; publishAt: number | null; expireAt: number | null }
  | { ok: false; message: string } {
  const publish = parseJstDatetimeLocalStrict(publishAt);
  const expire = parseJstDatetimeLocalStrict(expireAt);
  if (!publish.ok || !expire.ok) {
    return {
      ok: false,
      message: "掲載日時の形式が正しくありません。",
    };
  }
  if (
    publish.value != null &&
    expire.value != null &&
    expire.value <= publish.value
  ) {
    return {
      ok: false,
      message: "掲載終了日時は掲載開始日時より後にしてください。",
    };
  }
  return { ok: true, publishAt: publish.value, expireAt: expire.value };
}

export function validateAnnouncementInput(
  raw: Record<string, unknown>,
):
  | { ok: true; data: AnnouncementInput; dates: ParsedAnnouncementDates }
  | { ok: false; message: string } {
  const parsed = announcementInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
    };
  }
  const dates = parseAnnouncementDates(parsed.data.publish_at, parsed.data.expire_at);
  if (!dates.ok) return dates;

  return { ok: true, data: parsed.data, dates };
}
