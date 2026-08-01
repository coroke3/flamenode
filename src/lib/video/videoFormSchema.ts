import { z } from "zod";
import { normalizeHttpUrl } from "@/lib/utils/url";
import { validateSocialLinksJson } from "@/lib/socialLinks";
import { normalizeSoftwareLabels } from "@/lib/utils/softwareLabels";
import { MAX_ATOMIC_VIDEO_SOFTWARES } from "@/lib/video/atomicLimits";

export function normalizeIconUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.length > 500) return null;
  if (s.startsWith("/api/media/")) return s;
  return normalizeHttpUrl(s, { maxLength: 500 });
}

function normalizeOptionalNullableText(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  return trimmed || null;
}

function preprocessYoutubeUrl(val: unknown): unknown {
  if (typeof val === "string") {
    return normalizeHttpUrl(val, { maxLength: 500 }) ?? val;
  }
  return val;
}

function preprocessOptionalYoutubeUrl(val: unknown): unknown {
  if (val === null || val === undefined) return "";
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (!trimmed) return "";
  return normalizeHttpUrl(trimmed, { maxLength: 500 }) ?? trimmed;
}

const youtubeUrlRequiredField = z.preprocess(
  preprocessYoutubeUrl,
  z.string().trim().url(),
);

const youtubeUrlOptionalField = z.preprocess(
  preprocessOptionalYoutubeUrl,
  z.union([z.literal(""), z.string().trim().url()]),
);

const videoFormBaseSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  creator_x_user_id: z.string().trim().max(32).optional().nullable(),
  icon_url: z.preprocess(
    (val) => normalizeIconUrl(val),
    z.string().trim().max(500).optional().nullable(),
  ),
  profile_text: z.preprocess(
    normalizeOptionalNullableText,
    z.string().max(1000).nullable().optional(),
  ),
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
    })
    .transform((value) => validateSocialLinksJson(value ?? "").value),
  title: z.string().trim().min(1).max(120),
  music: z.string().trim().max(200).optional().nullable(),
  music_reference_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
  credit: z.string().trim().max(200).optional().nullable(),
  intro_comment: z.string().trim().max(500).optional().nullable(),
  highlights: z.string().trim().max(1000).optional().nullable(),
  production_story: z.string().trim().max(1000).optional().nullable(),
  used_software: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .superRefine((value, ctx) => {
      if (normalizeSoftwareLabels(value).length <= MAX_ATOMIC_VIDEO_SOFTWARES) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `使用ソフトは最大${MAX_ATOMIC_VIDEO_SOFTWARES}件です。`,
      });
    }),
  closing_comment: z.string().trim().max(500).optional().nullable(),
  is_collab: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  part: z.string().trim().max(40).optional().nullable(),
});

export const videoFormSchema = videoFormBaseSchema.extend({
  youtube_url: youtubeUrlRequiredField,
});

export type VideoFormData = z.infer<typeof videoFormSchema>;

export type ParseVideoFormOptions = {
  youtubeRequired?: boolean;
};

function buildVideoFormSchema(youtubeRequired: boolean) {
  return videoFormBaseSchema.extend({
    youtube_url: youtubeRequired ? youtubeUrlRequiredField : youtubeUrlOptionalField,
  });
}

export function parseVideoForm(
  raw: Record<string, unknown>,
  options?: ParseVideoFormOptions,
):
  | { ok: true; data: VideoFormData }
  | { ok: false; message: string } {
  const youtubeRequired = options?.youtubeRequired ?? true;
  const input = youtubeRequired
    ? raw
    : {
        ...raw,
        youtube_url: Object.prototype.hasOwnProperty.call(raw, "youtube_url")
          ? raw.youtube_url
          : "",
      };
  const parsed = buildVideoFormSchema(youtubeRequired).safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const data =
    raw.icon_mode === "none"
      ? { ...parsed.data, icon_url: null }
      : parsed.data;
  return { ok: true, data };
}
