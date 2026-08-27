import type { VideoEditSectionKey } from "@/lib/auth/videoEditSections";

export const GENERAL_EDITABLE_FIELD_KEYS = [
  "title",
  "youtube_url",
  "display_name",
  "icon_url",
  "profile_text",
  "youtube_channel_url",
  "other_social_links",
  "part",
  "music",
  "music_reference_url",
  "credit",
  "intro_comment",
  "used_software",
  "highlights",
  "production_story",
  "closing_comment",
  "custom_answers",
  "stage_permission",
  "event_ids",
  "is_collab",
  "members",
  "chapters",
] as const;

export type GeneralEditableFieldKey = (typeof GENERAL_EDITABLE_FIELD_KEYS)[number];

export type VideoParameterRisk = "normal" | "sensitive" | "dangerous" | "system";

/**
 * Database-backed video values which are intentionally not part of the
 * owner-configurable registry.  Keeping this list explicit prevents a new
 * column from becoming editable merely because it is added to a form.
 */
export const VIDEO_SYSTEM_ONLY_PARAMETER_KEYS = [
  "creator_x_user_id",
  "submitted_by_user_id",
  "source_type",
  "scheduling_type",
  "scheduled_time",
  "visibility_status",
  "app_like_count",
  "score",
  "score_updated_at",
  "created_at",
  "updated_at",
  "creator_display_name_yomi",
] as const;

const GENERAL_EDITABLE_FIELD_KEY_SET = new Set<string>(GENERAL_EDITABLE_FIELD_KEYS);

export const GENERAL_EDITABLE_FIELD_LABELS: Record<GeneralEditableFieldKey, string> = {
  youtube_url: "YouTube URL",
  title: "タイトル",
  display_name: "表示名",
  icon_url: "アイコン",
  profile_text: "プロフィール文",
  youtube_channel_url: "YouTubeチャンネルURL",
  other_social_links: "SNS・外部リンク",
  part: "部",
  music: "楽曲",
  music_reference_url: "楽曲参照URL",
  credit: "クレジット",
  intro_comment: "紹介コメント",
  used_software: "使用ソフト",
  highlights: "見どころ",
  production_story: "制作エピソード",
  closing_comment: "締めコメント",
  custom_answers: "カスタム質問の回答",
  stage_permission: "ステージ・権利確認の回答",
  event_ids: "所属イベント",
  is_collab: "合作状態",
  members: "メンバー",
  chapters: "チャプター",
};

export const GENERAL_EDITABLE_FIELD_HELP: Record<GeneralEditableFieldKey, string> = {
  youtube_url: "YouTube URL",
  title: "作品タイトルを直せます",
  display_name: "作品ごとの作者名を直せます",
  icon_url: "作品ごとのアイコンを直せます",
  profile_text: "提出者プロフィール文を直せます",
  youtube_channel_url: "提出者のYouTubeチャンネルURLを直せます",
  other_social_links: "提出者のSNS・外部リンクを直せます",
  part: "作品の部を直せます（枠投稿は枠から自動設定）",
  music: "使用楽曲名を直せます",
  music_reference_url: "楽曲参照URLを直せます",
  credit: "クレジット表記を直せます",
  intro_comment: "冒頭の紹介文を直せます",
  used_software: "使用ソフト名を直せます",
  highlights: "見どころ欄を直せます",
  production_story: "制作エピソードを直せます",
  closing_comment: "あとがきを直せます",
  custom_answers: "イベントの一般カスタム質問への回答を直せます",
  stage_permission: "ステージ・権利確認の回答を直せます",
  event_ids: "作品の所属イベントを直せます（イベント側の制約を維持）",
  is_collab: "合作作品かどうかを直せます",
  members: "合作メンバー一覧を直せます",
  chapters: "通常チャプターを直せます",
};

export const GENERAL_EDITABLE_FIELD_GROUPS: Array<{
  label: string;
  description: string;
  fields: ReadonlyArray<readonly [GeneralEditableFieldKey, string]>;
}> = [
  {
    label: "提出者情報",
    description: "作品に保存される提出者プロフィールの項目",
    fields: [
      ["display_name", GENERAL_EDITABLE_FIELD_LABELS.display_name],
      ["icon_url", GENERAL_EDITABLE_FIELD_LABELS.icon_url],
      ["profile_text", GENERAL_EDITABLE_FIELD_LABELS.profile_text],
      ["youtube_channel_url", GENERAL_EDITABLE_FIELD_LABELS.youtube_channel_url],
      ["other_social_links", GENERAL_EDITABLE_FIELD_LABELS.other_social_links],
    ],
  },
  {
    label: "作品情報",
    description: "作品の基本情報と公開先に関わる項目",
    fields: [
      ["title", GENERAL_EDITABLE_FIELD_LABELS.title],
      ["youtube_url", GENERAL_EDITABLE_FIELD_LABELS.youtube_url],
      ["part", GENERAL_EDITABLE_FIELD_LABELS.part],
    ],
  },
  {
    label: "楽曲・クレジット",
    description: "楽曲情報とクレジット表記",
    fields: [
      ["music", GENERAL_EDITABLE_FIELD_LABELS.music],
      ["music_reference_url", GENERAL_EDITABLE_FIELD_LABELS.music_reference_url],
      ["credit", GENERAL_EDITABLE_FIELD_LABELS.credit],
    ],
  },
  {
    label: "紹介・振り返り",
    description: "作品の紹介文と制作後のコメント",
    fields: [
      ["intro_comment", GENERAL_EDITABLE_FIELD_LABELS.intro_comment],
      ["used_software", GENERAL_EDITABLE_FIELD_LABELS.used_software],
      ["highlights", GENERAL_EDITABLE_FIELD_LABELS.highlights],
      ["production_story", GENERAL_EDITABLE_FIELD_LABELS.production_story],
      ["closing_comment", GENERAL_EDITABLE_FIELD_LABELS.closing_comment],
    ],
  },
  {
    label: "イベント回答",
    description: "イベントごとの質問回答と所属設定",
    fields: [
      ["custom_answers", GENERAL_EDITABLE_FIELD_LABELS.custom_answers],
      ["stage_permission", GENERAL_EDITABLE_FIELD_LABELS.stage_permission],
      ["event_ids", GENERAL_EDITABLE_FIELD_LABELS.event_ids],
    ],
  },
  {
    label: "合作",
    description: "合作状態、メンバー、チャプター",
    fields: [
      ["members", GENERAL_EDITABLE_FIELD_LABELS.members],
      ["is_collab", GENERAL_EDITABLE_FIELD_LABELS.is_collab],
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

/** 旧 section key を canonical field へ保守的に展開する。 */
const LEGACY_GENERAL_FIELD_EXPANSIONS: Record<string, readonly GeneralEditableFieldKey[]> = {
  "video.basics": ["title", "part"],
  "videos.title": ["title"],
  "video.identity": ["display_name", "icon_url"],
  "video.primary_event": ["event_ids"],
  "videos.primary_event": ["event_ids"],
  "video.credits": ["music", "music_reference_url", "credit"],
  "videos.music_credit": ["music", "music_reference_url", "credit"],
  "video.descriptions": [
    "intro_comment", "used_software", "highlights", "production_story",
    "closing_comment", "custom_answers",
  ],
  "videos.review_data": [
    "intro_comment", "used_software", "highlights", "production_story",
    "closing_comment", "custom_answers",
  ],
  "video.members": ["is_collab", "members"],
  "videos.members": ["is_collab", "members"],
  "video.member_chapters": ["chapters"],
  "video.members_chapters": ["chapters"],
};

const DISABLED_FIELD_PATH_BY_KEY: Record<GeneralEditableFieldKey, string> = {
  title: "video.title",
  youtube_url: "video.youtube_url",
  display_name: "submitter.display_name",
  icon_url: "submitter.icon_url",
  profile_text: "submitter.profile_text",
  youtube_channel_url: "submitter.youtube_channel_url",
  other_social_links: "submitter.other_social_links",
  part: "video.part",
  music: "video.music",
  music_reference_url: "video.music_reference_url",
  credit: "video.credit",
  intro_comment: "descriptions.intro_comment",
  used_software: "descriptions.used_software",
  highlights: "descriptions.highlights",
  production_story: "descriptions.production_story",
  closing_comment: "descriptions.closing_comment",
  custom_answers: "descriptions.custom_answers",
  stage_permission: "descriptions.stage_permission",
  event_ids: "event_ids",
  is_collab: "members.is_collab",
  members: "members",
  chapters: "chapters",
};

const EVENT_PERMISSION_KEY_BY_FIELD: Record<GeneralEditableFieldKey, VideoEditSectionKey> = {
  title: "video.basics",
  youtube_url: "video.youtube_id",
  display_name: "video.identity",
  icon_url: "video.identity",
  profile_text: "video.identity",
  youtube_channel_url: "video.identity",
  other_social_links: "video.identity",
  part: "video.basics",
  music: "video.credits",
  music_reference_url: "video.credits",
  credit: "video.credits",
  intro_comment: "video.descriptions",
  used_software: "video.descriptions",
  highlights: "video.descriptions",
  production_story: "video.descriptions",
  closing_comment: "video.descriptions",
  custom_answers: "video.descriptions",
  stage_permission: "video.descriptions",
  event_ids: "video.primary_event",
  is_collab: "video.members",
  members: "video.members",
  chapters: "video.member_chapters",
};

/** Global/event UI と保存時検証が共有する field registry。 */
export type OwnerEditableFieldDefinition = {
  key: GeneralEditableFieldKey;
  label: string;
  help: string;
  group: string;
  formPath: string;
  eventPermissionKey: VideoEditSectionKey;
  risk: VideoParameterRisk;
  ownerConfigurable: boolean;
  eventOverrideConfigurable: boolean;
  dangerous: false;
};

export const OWNER_EDITABLE_FIELD_DEFINITIONS: readonly OwnerEditableFieldDefinition[] =
  GENERAL_EDITABLE_FIELD_KEYS.map((key) => ({
    key,
    label: GENERAL_EDITABLE_FIELD_LABELS[key],
    help: GENERAL_EDITABLE_FIELD_HELP[key],
    group:
      GENERAL_EDITABLE_FIELD_GROUPS.find((group) =>
        group.fields.some(([fieldKey]) => fieldKey === key),
      )?.label ?? "その他",
    formPath: DISABLED_FIELD_PATH_BY_KEY[key],
    eventPermissionKey: EVENT_PERMISSION_KEY_BY_FIELD[key],
    risk: key === "youtube_url" ? "sensitive" : "normal",
    ownerConfigurable: true,
    eventOverrideConfigurable: true,
    dangerous: false,
  }));

function isGeneralEditableFieldKey(value: string): value is GeneralEditableFieldKey {
  return GENERAL_EDITABLE_FIELD_KEY_SET.has(value);
}

export function normalizeGeneralEditableFields(
  values: readonly FormDataEntryValue[],
): GeneralEditableFieldKey[] {
  const selected = new Set<string>();
  for (const value of values) {
    const key = String(value).trim();
    if (isGeneralEditableFieldKey(key)) {
      selected.add(key);
      continue;
    }
    for (const expanded of LEGACY_GENERAL_FIELD_EXPANSIONS[key] ?? []) {
      selected.add(expanded);
    }
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
  let parts: string[] = value.split(",");
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmedValue) as unknown;
      if (Array.isArray(parsed)) {
        parts = parsed.filter((part): part is string => typeof part === "string");
      }
    } catch {
      return out;
    }
  }
  for (const part of parts) {
    const key = part.trim();
    if (isGeneralEditableFieldKey(key)) {
      out.add(key);
      continue;
    }
    for (const expanded of LEGACY_GENERAL_FIELD_EXPANSIONS[key] ?? []) {
      out.add(expanded);
    }
  }
  return out;
}

export type GeneralEditablePolicyV2 = {
  version: 2;
  fallback: "inherit" | "deny";
  allow: GeneralEditableFieldKey[];
  deny: GeneralEditableFieldKey[];
  inherit: GeneralEditableFieldKey[];
};

function normalizePolicyFieldList(value: unknown): GeneralEditableFieldKey[] | null {
  if (!Array.isArray(value)) return null;
  // A v2 policy is an explicit server-side contract.  Unknown string keys
  // are intentionally ignored for forward compatibility, but non-string
  // entries make the document malformed and must fail closed.
  if (value.some((entry) => typeof entry !== "string")) return null;
  const normalized = normalizeGeneralEditableFields(
    value,
  );
  return normalized;
}

/** Parse the opt-in v2 policy. Invalid/unknown versions fail closed. */
export function parseGeneralEditablePolicyV2(
  value: string | null | undefined,
): GeneralEditablePolicyV2 | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || parsed.version !== 2) return null;
    if (parsed.fallback !== "inherit" && parsed.fallback !== "deny") return null;
    const allow = normalizePolicyFieldList(parsed.allow);
    const deny = normalizePolicyFieldList(parsed.deny);
    const inherit = normalizePolicyFieldList(parsed.inherit);
    if (!allow || !deny || !inherit) return null;
    const seen = new Set<GeneralEditableFieldKey>();
    for (const list of [allow, deny, inherit]) {
      for (const key of list) {
        if (seen.has(key)) return null;
        seen.add(key);
      }
    }
    return { version: 2, fallback: parsed.fallback, allow, deny, inherit };
  } catch {
    return null;
  }
}

/** Resolve one event policy against the current global field set. */
export function resolveGeneralEditableFieldsFromPolicy(args: {
  allowUserVideoEdits: number | null | undefined;
  policyJson: string | null | undefined;
  globalFields: ReadonlySet<GeneralEditableFieldKey>;
}): Set<GeneralEditableFieldKey> {
  if (args.allowUserVideoEdits !== 1) return new Set(args.globalFields);
  const raw = args.policyJson?.trim() ?? "";
  if (!raw) return new Set();
  if (raw.startsWith("[")) return parseGeneralEditableFields(raw);
  // Some pre-v2 imports stored the same exact override as a comma-separated
  // string. Preserve that legacy representation; object-shaped values are
  // reserved for v2 and therefore fail closed when invalid.
  if (!raw.startsWith("{")) return parseGeneralEditableFields(raw);
  const policy = parseGeneralEditablePolicyV2(raw);
  if (!policy) return new Set();
  const allow = new Set(policy.allow);
  const deny = new Set(policy.deny);
  const inherit = new Set(policy.inherit);
  const resolved = new Set<GeneralEditableFieldKey>();
  for (const key of GENERAL_EDITABLE_FIELD_KEYS) {
    if (allow.has(key)) {
      resolved.add(key);
    } else if (deny.has(key)) {
      continue;
    } else if (inherit.has(key) || policy.fallback === "inherit") {
      if (args.globalFields.has(key)) resolved.add(key);
    }
  }
  return resolved;
}

export function resolveGeneralEditableScope(
  video: { visibility_status: string },
): "default" | "upcoming" {
  return video.visibility_status === "public" ? "default" : "upcoming";
}

export function sectionAllowedByGeneralFields(
  sectionKey: VideoEditSectionKey | string,
  fields: ReadonlySet<GeneralEditableFieldKey>,
): boolean {
  switch (sectionKey) {
    case "video.basics":
    case "videos.title":
      return fields.has("title") || fields.has("part");
    case "video.identity":
      return ["display_name", "icon_url", "profile_text", "youtube_channel_url", "other_social_links"]
        .some((key) => fields.has(key as GeneralEditableFieldKey));
    case "video.credits":
    case "videos.music_credit":
      return fields.has("music") || fields.has("music_reference_url") || fields.has("credit");
    case "video.descriptions":
    case "videos.review_data":
      return DESCRIPTION_FIELD_KEYS.some((key) => fields.has(key)) || fields.has("custom_answers") || fields.has("stage_permission");
    case "video.members":
    case "videos.members":
      return fields.has("members") || fields.has("is_collab");
    case "video.member_chapters":
      return fields.has("chapters");
    case "video.youtube_id":
    case "videos.youtube_id":
      return fields.has("youtube_url");
    case "video.primary_event":
    case "videos.primary_event":
      return fields.has("event_ids");
    case "video.status":
    case "video.chapter_admin":
      return false;
    default:
      return false;
  }
}

export function disabledFieldKeysFromGeneralFields(
  fields: ReadonlySet<GeneralEditableFieldKey>,
): string[] {
  return GENERAL_EDITABLE_FIELD_KEYS
    .filter((key) => !fields.has(key))
    .map((key) => DISABLED_FIELD_PATH_BY_KEY[key]);
}
