import { z } from "zod";
import { normalizeHttpUrl } from "@/lib/utils/url";
import { validateSocialLinksJson } from "@/lib/socialLinks";

export function normalizeIconUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.length > 500) return null;
  if (s.startsWith("/api/media/")) return s;
  return normalizeHttpUrl(s, { maxLength: 500 });
}

export const videoFormSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  creator_x_user_id: z.string().trim().max(32).optional().nullable(),
  icon_url: z.preprocess(
    (val) => normalizeIconUrl(val),
    z.string().trim().max(500).optional().nullable(),
  ),
  profile_text: z.string().trim().max(1000).optional().nullable(),
  youtube_channel_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
  other_social_links: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .nullable()
    .superRefine((value, ctx) => {
      const result = validateSocialLinksJson(value ?? "");
      if (result.ok) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          result.message ??
          "SNSリンクには、Email はメールアドレス、それ以外は http/https の有効なURLを入力してください。",
      });
    }),
  title: z.string().trim().min(1).max(120),
  youtube_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) ?? val : val),
    z.string().trim().url(),
  ),
  music: z.string().trim().max(200).optional().nullable(),
  music_reference_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
  credit: z.string().trim().max(200).optional().nullable(),
  intro_comment: z.string().trim().max(500).optional().nullable(),
  highlights: z.string().trim().max(1000).optional().nullable(),
  production_story: z.string().trim().max(1000).optional().nullable(),
  used_software: z.string().trim().max(200).optional().nullable(),
  closing_comment: z.string().trim().max(500).optional().nullable(),
  is_collab: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  part: z.string().trim().max(40).optional().nullable(),
});

export type VideoFormData = z.infer<typeof videoFormSchema>;

export function parseVideoForm(
  raw: Record<string, unknown>,
):
  | { ok: true; data: VideoFormData }
  | { ok: false; message: string } {
  const parsed = videoFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  return { ok: true, data: parsed.data };
}
