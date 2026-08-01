import type { VideoEditSectionKey } from "@/lib/auth/videoEditSections";

export const GENERAL_EDITABLE_FIELD_KEYS = [
  "title",
  "display_name",
  "icon_url",
  "music",
  "credit",
  "intro_comment",
  "used_software",
  "highlights",
  "production_story",
  "closing_comment",
  "members",
  "chapters",
] as const;

export type GeneralEditableFieldKey = (typeof GENERAL_EDITABLE_FIELD_KEYS)[number];

const GENERAL_EDITABLE_FIELD_KEY_SET = new Set<string>(GENERAL_EDITABLE_FIELD_KEYS);

export const GENERAL_EDITABLE_FIELD_LABELS: Record<GeneralEditableFieldKey, string> = {
  title: "タイトル",
  display_name: "表示名",
  icon_url: "アイコン",
  music: "楽曲",
  credit: "クレジット",
  intro_comment: "紹介コメント",
  used_software: "使用ソフト",
  highlights: "見どころ",
  production_story: "制作エピソード",
  closing_comment: "締めコメント",
  members: "メンバー",
  chapters: "チャプター",
};

export const GENERAL_EDITABLE_FIELD_HELP: Record<GeneralEditableFieldKey, string> = {
  title: "作品タイトルを直せます",
  display_name: "作品ごとの作者名を直せます",
  icon_url: "作品ごとのアイコンを直せます",
  music: "使用楽曲名を直せます",
  credit: "クレジット表記を直せます",
  intro_comment: "冒頭の紹介文を直せます",
  used_software: "使用ソフト名を直せます",
  highlights: "見どころ欄を直せます",
  production_story: "制作エピソードを直せます",
  closing_comment: "あとがきを直せます",
  members: "合作メンバー一覧を直せます",
  chapters: "通常チャプターを直せます",
};

export const GENERAL_EDITABLE_FIELD_GROUPS: Array<{
  label: string;
  description: string;
  fields: ReadonlyArray<readonly [GeneralEditableFieldKey, string]>;
}> = [
  {
    label: "基本情報",
    description: "作品の見出しや表示に関わる項目",
    fields: [
      ["title", GENERAL_EDITABLE_FIELD_LABELS.title],
      ["display_name", GENERAL_EDITABLE_FIELD_LABELS.display_name],
      ["icon_url", GENERAL_EDITABLE_FIELD_LABELS.icon_url],
    ],
  },
  {
    label: "本文・コメント",
    description: "作品の説明文・コメント類",
    fields: [
      ["music", GENERAL_EDITABLE_FIELD_LABELS.music],
      ["credit", GENERAL_EDITABLE_FIELD_LABELS.credit],
      ["intro_comment", GENERAL_EDITABLE_FIELD_LABELS.intro_comment],
      ["used_software", GENERAL_EDITABLE_FIELD_LABELS.used_software],
      ["highlights", GENERAL_EDITABLE_FIELD_LABELS.highlights],
      ["production_story", GENERAL_EDITABLE_FIELD_LABELS.production_story],
      ["closing_comment", GENERAL_EDITABLE_FIELD_LABELS.closing_comment],
    ],
  },
  {
    label: "構成情報",
    description: "メンバー・チャプターなど構造的な項目",
    fields: [
      ["members", GENERAL_EDITABLE_FIELD_LABELS.members],
      ["chapters", GENERAL_EDITABLE_FIELD_LABELS.chapters],
    ],
  },
];

const DESCRIPTION_FIELD_KEYS: readonly GeneralEditableFieldKey[] = [
  "intro_comment",
  "used_software",
  "highlights",
  "production_story",
  "closing_comment",
];

const DISABLED_FIELD_PATH_BY_KEY: Record<GeneralEditableFieldKey, string> = {
  title: "video.title",
  display_name: "submitter.display_name",
  icon_url: "submitter.icon_url",
  music: "video.music",
  credit: "video.credit",
  intro_comment: "descriptions.intro_comment",
  used_software: "descriptions.used_software",
  highlights: "descriptions.highlights",
  production_story: "descriptions.production_story",
  closing_comment: "descriptions.closing_comment",
  members: "members",
  chapters: "chapters",
};

function isGeneralEditableFieldKey(value: string): value is GeneralEditableFieldKey {
  return GENERAL_EDITABLE_FIELD_KEY_SET.has(value);
}

export function normalizeGeneralEditableFields(
  values: readonly FormDataEntryValue[],
): GeneralEditableFieldKey[] {
  const selected = new Set<string>();
  for (const value of values) {
    const key = String(value).trim();
    if (isGeneralEditableFieldKey(key)) selected.add(key);
  }
  return GENERAL_EDITABLE_FIELD_KEYS.filter((key) => selected.has(key));
}

export function serializeGeneralEditableFields(
  fields: readonly GeneralEditableFieldKey[],
): string {
  const selected = new Set(fields);
  const ordered = GENERAL_EDITABLE_FIELD_KEYS.filter((key) => selected.has(key));
  return ordered.length > 0 ? ordered.join(",") : "";
}

export function parseGeneralEditableFields(
  value: string | null | undefined,
): Set<GeneralEditableFieldKey> {
  const out = new Set<GeneralEditableFieldKey>();
  if (!value) return out;
  for (const part of value.split(",")) {
    const key = part.trim();
    if (isGeneralEditableFieldKey(key)) out.add(key);
  }
  return out;
}

export function resolveGeneralEditableScope(
  video: { visibility_status: string },
): "default" | "upcoming" {
  return video.visibility_status === "public" ? "default" : "upcoming";
}

export function sectionAllowedByGeneralFields(
  sectionKey: VideoEditSectionKey | string,
  fields: Set<GeneralEditableFieldKey>,
): boolean {
  switch (sectionKey) {
    case "video.basics":
    case "videos.title":
      return fields.has("title");
    case "video.identity":
      return fields.has("display_name") || fields.has("icon_url");
    case "video.credits":
    case "videos.music_credit":
      return fields.has("music") || fields.has("credit");
    case "video.descriptions":
    case "videos.review_data":
      return DESCRIPTION_FIELD_KEYS.some((key) => fields.has(key));
    case "video.members":
    case "videos.members":
      return fields.has("members");
    case "video.member_chapters":
      return fields.has("chapters");
    case "video.youtube_id":
    case "videos.youtube_id":
    case "video.primary_event":
    case "videos.primary_event":
    case "video.status":
    case "video.chapter_admin":
      return false;
    default:
      return false;
  }
}

export const NORMAL_MODE_ALWAYS_DISABLED_FIELD_KEYS = [
  "descriptions.stage_permission",
] as const;

/** 一般編集モードでは常に UI 無効化するフィールド (一般作品権限の対象外)。 */
export function normalModeAlwaysDisabledFieldKeys(): string[] {
  return [...NORMAL_MODE_ALWAYS_DISABLED_FIELD_KEYS];
}

export function disabledFieldKeysFromGeneralFields(
  fields: Set<GeneralEditableFieldKey>,
): string[] {
  return GENERAL_EDITABLE_FIELD_KEYS
    .filter((key) => !fields.has(key))
    .map((key) => DISABLED_FIELD_PATH_BY_KEY[key]);
}
