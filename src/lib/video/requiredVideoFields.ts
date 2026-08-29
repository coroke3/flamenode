import { inArray } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import { events } from "../db/schema.ts";

export const ALWAYS_REQUIRED_VIDEO_FIELDS = ["display_name", "title"] as const;

export const OPTIONAL_REQUIRED_VIDEO_FIELDS = [
  "icon_url",
  "profile_text",
  "youtube_channel_url",
  "other_social_links",
  "music",
  "music_reference_url",
  "credit",
  "intro_comment",
  "highlights",
  "production_story",
  "used_software",
  "closing_comment",
  "part",
  "youtube_url",
] as const;

export type AlwaysRequiredVideoField =
  (typeof ALWAYS_REQUIRED_VIDEO_FIELDS)[number];
export type OptionalRequiredVideoField =
  (typeof OPTIONAL_REQUIRED_VIDEO_FIELDS)[number];
export type RequiredVideoField =
  | AlwaysRequiredVideoField
  | OptionalRequiredVideoField;
export type RequiredVideoFieldWizardStep = "submitter" | "work" | "youtube";

const OPTIONAL_REQUIRED_VIDEO_FIELD_SET = new Set<string>(
  OPTIONAL_REQUIRED_VIDEO_FIELDS,
);

export const REQUIRED_VIDEO_FIELD_LABELS: Record<RequiredVideoField, string> = {
  display_name: "表示名",
  title: "作品タイトル",
  icon_url: "アイコン",
  profile_text: "自分・団体の概要",
  youtube_channel_url: "YouTubeチャンネル",
  other_social_links: "その他のSNSリンク",
  music: "使用楽曲",
  music_reference_url: "楽曲参考URL",
  credit: "クレジット",
  intro_comment: "紹介コメント",
  highlights: "みどころ",
  production_story: "制作エピソード",
  used_software: "使用ソフト",
  closing_comment: "あとがき",
  part: "部",
  youtube_url: "YouTube URL",
};

export const REQUIRED_VIDEO_FIELD_WIZARD_STEP: Record<
  RequiredVideoField,
  RequiredVideoFieldWizardStep
> = {
  display_name: "submitter",
  icon_url: "submitter",
  profile_text: "submitter",
  youtube_channel_url: "submitter",
  other_social_links: "submitter",
  title: "work",
  music: "work",
  music_reference_url: "work",
  credit: "work",
  intro_comment: "work",
  highlights: "work",
  production_story: "work",
  used_software: "work",
  closing_comment: "work",
  part: "work",
  youtube_url: "youtube",
};

export const REQUIRED_VIDEO_FIELD_GROUPS: ReadonlyArray<{
  id: RequiredVideoFieldWizardStep;
  label: string;
  always: readonly AlwaysRequiredVideoField[];
  optional: readonly OptionalRequiredVideoField[];
}> = [
  {
    id: "submitter",
    label: "提出者情報",
    always: ["display_name"],
    optional: [
      "icon_url",
      "profile_text",
      "youtube_channel_url",
      "other_social_links",
    ],
  },
  {
    id: "work",
    label: "作品情報",
    always: ["title"],
    optional: [
      "music",
      "music_reference_url",
      "credit",
      "intro_comment",
      "highlights",
      "production_story",
      "used_software",
      "closing_comment",
      "part",
    ],
  },
  {
    id: "youtube",
    label: "YouTube",
    always: [],
    optional: ["youtube_url"],
  },
];

export type RequiredVideoFieldValues = {
  display_name?: string | null;
  title?: string | null;
  icon_mode?: string | null;
  icon_url?: string | null;
  profile_text?: string | null;
  youtube_channel_url?: string | null;
  other_social_links?: string | null;
  music?: string | null;
  music_reference_url?: string | null;
  credit?: string | null;
  intro_comment?: string | null;
  highlights?: string | null;
  production_story?: string | null;
  used_software?: string | null;
  closing_comment?: string | null;
  part?: string | null;
  youtube_url?: string | null;
};

function isOptionalRequiredVideoField(
  value: string,
): value is OptionalRequiredVideoField {
  return OPTIONAL_REQUIRED_VIDEO_FIELD_SET.has(value);
}

function isFilledText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseRequiredVideoFields(
  raw: unknown,
): OptionalRequiredVideoField[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<OptionalRequiredVideoField>();
  const fields: OptionalRequiredVideoField[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const key = item.trim();
    if (!isOptionalRequiredVideoField(key) || seen.has(key)) continue;
    seen.add(key);
    fields.push(key);
  }
  return OPTIONAL_REQUIRED_VIDEO_FIELDS.filter((field) => seen.has(field));
}

export function serializeRequiredVideoFields(
  raw: unknown,
): string | null {
  const fields = parseRequiredVideoFields(
    Array.isArray(raw) || typeof raw === "string" ? raw : Array.from(
      (raw as Iterable<unknown> | null | undefined) ?? [],
    ),
  );
  return fields.length > 0 ? JSON.stringify(fields) : null;
}

export function serializeRequiredVideoFieldsFromForm(
  formData: FormData,
): string | null | undefined {
  if (String(formData.get("required_video_fields_present") ?? "") !== "1") {
    return undefined;
  }
  if (formData.has("required_video_fields_json")) {
    return serializeRequiredVideoFields(
      String(formData.get("required_video_fields_json") ?? ""),
    );
  }
  return serializeRequiredVideoFields(formData.getAll("required_video_fields"));
}

export function unionRequiredVideoFields(
  jsonList: ReadonlyArray<string | null | undefined>,
): OptionalRequiredVideoField[] {
  const seen = new Set<OptionalRequiredVideoField>();
  for (const json of jsonList) {
    for (const field of parseRequiredVideoFields(json)) seen.add(field);
  }
  return OPTIONAL_REQUIRED_VIDEO_FIELDS.filter((field) => seen.has(field));
}

export async function loadUnionRequiredVideoFields(
  db: DB,
  eventIds: readonly string[],
): Promise<OptionalRequiredVideoField[]> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const rows = await db
    .select({ required_video_fields_json: events.required_video_fields_json })
    .from(events)
    .where(inArray(events.id, ids));
  return unionRequiredVideoFields(
    rows.map((row) => row.required_video_fields_json),
  );
}

export function isRequiredVideoFieldFilled(
  field: OptionalRequiredVideoField,
  values: RequiredVideoFieldValues,
): boolean {
  if (field === "icon_url") {
    if (values.icon_mode === "keep") return true;
    if (values.icon_mode === "none") return false;
    return isFilledText(values.icon_url);
  }
  if (field === "other_social_links") {
    const raw = values.other_social_links;
    if (!isFilledText(raw)) return false;
    const trimmed = String(raw).trim();
    if (trimmed === "[]" || trimmed === "{}" || trimmed === "null") return false;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.length > 0;
      if (parsed && typeof parsed === "object") {
        return Object.keys(parsed).length > 0;
      }
    } catch {
      return true;
    }
    return true;
  }
  return isFilledText(values[field]);
}

export function firstMissingRequiredVideoField(
  required: readonly OptionalRequiredVideoField[],
  values: RequiredVideoFieldValues,
  editable?: ReadonlySet<string>,
): OptionalRequiredVideoField | null {
  for (const field of required) {
    if (editable && !editable.has(field)) continue;
    if (!isRequiredVideoFieldFilled(field, values)) return field;
  }
  return null;
}

export function missingRequiredVideoFieldMessage(
  field: RequiredVideoField,
): string {
  return `「${REQUIRED_VIDEO_FIELD_LABELS[field]}」は必須です。`;
}

export function formatRequiredVideoFieldSummary(
  json: string | null | undefined,
): string {
  const fields = parseRequiredVideoFields(json);
  if (fields.length === 0) return "表示名とタイトルのみ";
  return fields.map((field) => REQUIRED_VIDEO_FIELD_LABELS[field]).join("、");
}
