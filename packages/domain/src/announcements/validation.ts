import { z } from "zod";
import { parseJstDatetimeLocalStrict } from "../datetime.ts";
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
