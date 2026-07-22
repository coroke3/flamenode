import type { LegacyParsedFile } from "./parse";

export type LegacyImportStrategy = "create_only" | "skip_existing" | "replace_imported";
export type CanonicalVisibility = "private" | "public";

export const MAX_LEGACY_VIDEO_FIELD_DECISIONS = 50;
export const MAX_LEGACY_CUSTOM_QUESTION_MAPPINGS = 18;
export const MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO = 4;

export type LegacyVideoFieldDecision =
  | {
      source_key: string;
      action: "custom_question";
      question_label: string;
    }
  | {
      source_key: string;
      action: "ignore";
    };

export type LegacyUnmappedVideoField = {
  source_key: string;
  non_empty_rows: number;
};

export type CanonicalLegacyPlan = {
  events: Array<{
    id: string;
    title: string;
    event_type: "event" | "collabo" | "type" | "other";
    explanation: string | null;
    icon_url: string | null;
    img_url: string | null;
    visibility_status: CanonicalVisibility;
    start_time: number | null;
    end_time: number | null;
  }>;
  eventStaff: Array<{
    id: string;
    event_id: string;
    x_user_id: string;
    display_name: string;
    permission_preset: "owner" | "public_staff";
    is_public: 0 | 1;
    public_role_label: string | null;
  }>;
  xUsers: Array<{
    id: string;
    x_name: string;
    icon_url: string | null;
    youtube_channel_url: string | null;
    other_social_links: string | null;
  }>;
  videos: Array<{
    id: string;
    primary_event_id: string | null;
    creator_x_user_id: string | null;
    collaboration_type: "individual" | "collab";
    source_type: "youtube" | "external";
    creator_display_name: string;
    creator_display_name_yomi: string | null;
    creator_icon_url: string | null;
    creator_youtube_channel_url: string | null;
    title: string;
    music: string | null;
    credit: string | null;
    music_reference_url: string | null;
    closing_comment: string | null;
    youtube_video_id: string | null;
    intro_comment: string | null;
    highlights: string | null;
    production_story: string | null;
    visibility_status: CanonicalVisibility;
    scheduling_type: "manual";
    scheduled_time: number | null;
    created_at: number;
  }>;
  videoEvents: Array<{ video_id: string; event_id: string }>;
  videoMembers: Array<{
    id: string;
    video_id: string;
    x_user_id: string | null;
    name: string;
    role: string | null;
    order_index: number;
  }>;
  videoChapters: Array<{
    id: string;
    video_id: string;
    x_user_id: string | null;
    chapter_time: number;
    chapter_label: string;
    note: string | null;
    visibility: "public";
  }>;
  videoSoftwares: Array<{ video_id: string; label: string }>;
  eventCustomQuestions: Array<{
    id: string;
    event_id: string;
    source_key: string;
    question_key: string;
    label: string;
    description: string;
    type: "textarea";
    required: 0;
    options_json: null;
    placeholder: null;
    max_length: 1000;
    sort_order: number;
    is_active: 1;
    visibility: "review";
  }>;
  videoCustomAnswers: Array<{
    video_id: string;
    event_id: string;
    question_id: string;
    question_key: string;
    answer_text: string;
    answer_json: null;
  }>;
  videoFieldDecisions: LegacyVideoFieldDecision[];
  unmappedVideoFields: LegacyUnmappedVideoField[];
  warnings: string[];
  errors: string[];
};

type NormalizeOptions = {
  eventVisibility: CanonicalVisibility;
  videoVisibility: CanonicalVisibility;
  videoFieldDecisions?: readonly LegacyVideoFieldDecision[];
  now?: number;
};

const MAX_CUSTOM_QUESTION_LABEL_LENGTH = 120;
const MAX_CUSTOM_ANSWER_LENGTH = 1000;

const CANONICAL_VIDEO_SOURCE_KEYS = new Set([
  "aftercomment",
  "beforecomment",
  "comment",
  "creator",
  "credit",
  "data",
  "eventid",
  "hitokoto",
  "icon",
  "member",
  "memberchapter",
  "memberid",
  "movieyear",
  "music",
  "othersns",
  "righttype",
  "soft",
  "starts",
  "time",
  "timestamp",
  "title",
  "tlink",
  "toudan",
  "type",
  "type2",
  "ychlink",
  "ycomment",
  "ylink",
  "ymulink",
  "yomi",
]);

function textValue(raw: unknown): string | null {
  if (raw == null) return null;
  let value: string;
  if (typeof raw === "object") {
    try {
      value = JSON.stringify(raw);
    } catch {
      return null;
    }
  } else {
    value = String(raw);
  }
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim();
  return normalized || null;
}

function stringValue(row: Record<string, unknown>, key: string): string | null {
  return textValue(row[key]);
}

function normalizeXId(raw: string | null): string | null {
  const value = (raw ?? "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
}

function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeIconUrl(raw: string | null): string | null {
  if (!raw) return null;
  const match =
    raw.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/) ??
    raw.match(/drive\.google\.com\/(?:open|uc)\?[^#]*[?&]?id=([A-Za-z0-9_-]+)/);
  if (match?.[1]) return `/api/google-drive-image/${match[1]}`;
  if (raw.startsWith("/api/")) return raw;
  return normalizeUrl(raw);
}

function splitList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((value) => value.trim());
  if (raw == null) return [];
  const values = String(raw).split(/[,，、\n]/).map((value) => value.trim());
  return values.length === 1 && values[0] === "" ? [] : values;
}

function toUnixSec(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (raw > 1e12) return Math.floor(raw / 1000);
    if (raw > 1e6) return Math.floor(raw);
    if (raw > 1 && raw < 60000) return Math.floor((raw - 25569) * 86400);
    return null;
  }
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return toUnixSec(Number(value));
  const jst = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (jst) {
    const ms = Date.UTC(
      Number(jst[1]),
      Number(jst[2]) - 1,
      Number(jst[3]),
      Number(jst[4] ?? 0) - 9,
      Number(jst[5] ?? 0),
      Number(jst[6] ?? 0),
    );
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function scheduledTime(row: Record<string, unknown>): number | null {
  const date = stringValue(row, "data");
  const time = stringValue(row, "time");
  if (date && time && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(time)) {
    return toUnixSec(`${date} ${time}`);
  }
  return toUnixSec(time) ?? toUnixSec(row.timestamp) ?? toUnixSec(date);
}

function extractYoutubeId(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  for (const pattern of [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?[^#]*v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/,
  ]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function stableId(prefix: string, seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function placeholderOwnerXId(eventId: string): string {
  const seed = stableId("evt_own", eventId).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const trimmed = seed.slice(0, 20);
  return normalizeXId(trimmed) ?? `imp_${trimmed.slice(0, 15)}`;
}

/** 旧形式インポート由来の Discord 未連携 X 名義へ割り当てる認証ユーザー ID。 */
export function legacyImportAuthUserId(xUserId: string): string {
  return stableId("usr_imp", xUserId);
}

function legacyQuestionKey(sourceKey: string): string {
  return stableId("legacy_import", sourceKey);
}

function decisionMaps(
  decisions: readonly LegacyVideoFieldDecision[],
  errors: string[],
): {
  customQuestions: Map<string, { label: string; sortOrder: number }>;
  ignored: Set<string>;
} {
  const customQuestions = new Map<string, { label: string; sortOrder: number }>();
  const ignored = new Set<string>();
  const seen = new Set<string>();
  const labels = new Set<string>();

  if (decisions.length > MAX_LEGACY_VIDEO_FIELD_DECISIONS) {
    errors.push(`動画の未対応項目の指定は最大${MAX_LEGACY_VIDEO_FIELD_DECISIONS}件です。`);
  }

  for (const decision of decisions.slice(0, MAX_LEGACY_VIDEO_FIELD_DECISIONS)) {
    const sourceKey = decision.source_key;
    if (
      !sourceKey ||
      sourceKey !== sourceKey.trim() ||
      sourceKey.length > 120 ||
      /[\u0000-\u001F\u007F]/.test(sourceKey)
    ) {
      errors.push("動画の未対応項目名は1〜120文字で指定してください。");
      continue;
    }
    if (CANONICAL_VIDEO_SOURCE_KEYS.has(sourceKey)) {
      errors.push(`動画項目「${sourceKey}」は正規カラムへ変換されるため、カスタム質問へ割り当てられません。`);
      continue;
    }
    if (seen.has(sourceKey)) {
      errors.push(`動画項目「${sourceKey}」の指定が重複しています。`);
      continue;
    }
    seen.add(sourceKey);

    if (decision.action === "ignore") {
      ignored.add(sourceKey);
      continue;
    }

    const label = decision.question_label.trim();
    if (!label || label.length > MAX_CUSTOM_QUESTION_LABEL_LENGTH) {
      errors.push(
        `動画項目「${sourceKey}」の質問文Qは1〜${MAX_CUSTOM_QUESTION_LABEL_LENGTH}文字で指定してください。`,
      );
      continue;
    }
    if (labels.has(label)) {
      errors.push(`カスタム質問の質問文Q「${label}」が重複しています。`);
      continue;
    }
    labels.add(label);
    customQuestions.set(sourceKey, {
      label,
      sortOrder: customQuestions.size,
    });
  }

  if (customQuestions.size > MAX_LEGACY_CUSTOM_QUESTION_MAPPINGS) {
    errors.push(`カスタム質問へ割り当てられる動画項目は最大${MAX_LEGACY_CUSTOM_QUESTION_MAPPINGS}件です。`);
  }
  return { customQuestions, ignored };
}

function eventType(raw: string | null): "event" | "collabo" | "type" | "other" {
  const value = (raw ?? "").toLowerCase();
  if (value === "collabo" || value === "collab" || value === "collaboration") return "collabo";
  if (value === "type") return "type";
  if (!value || value === "event") return "event";
  return "other";
}

function isVideoRow(row: Record<string, unknown>): boolean {
  return ["ylink", "tlink", "creator", "type2", "beforecomment", "aftercomment"].some(
    (key) => key in row,
  );
}

function memberStarts(raw: unknown): Array<number | null> {
  return splitList(raw).map((value) => {
    if (!value) return null;
    const match = value.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
    if (match) return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  });
}

export function normalizeLegacyFiles(
  files: readonly LegacyParsedFile[],
  options: NormalizeOptions,
): CanonicalLegacyPlan {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const events = new Map<string, CanonicalLegacyPlan["events"][number]>();
  const staff = new Map<string, CanonicalLegacyPlan["eventStaff"][number]>();
  const xUsers = new Map<string, CanonicalLegacyPlan["xUsers"][number]>();
  const videos = new Map<string, CanonicalLegacyPlan["videos"][number]>();
  const videoEvents = new Map<string, CanonicalLegacyPlan["videoEvents"][number]>();
  const members = new Map<string, CanonicalLegacyPlan["videoMembers"][number]>();
  const chapters = new Map<string, CanonicalLegacyPlan["videoChapters"][number]>();
  const softwares = new Map<string, CanonicalLegacyPlan["videoSoftwares"][number]>();
  const eventCustomQuestions = new Map<
    string,
    CanonicalLegacyPlan["eventCustomQuestions"][number]
  >();
  const videoCustomAnswers = new Map<
    string,
    CanonicalLegacyPlan["videoCustomAnswers"][number]
  >();
  const autoIgnoredFieldCounts = new Map<string, number>();
  const seenCustomSourceKeys = new Set<string>();
  const seenDecisionSourceKeys = new Set<string>();
  const ignoredFieldCounts = new Map<string, number>();
  const warnings: string[] = [];
  const errors: string[] = [];
  const fieldDecisions = decisionMaps(options.videoFieldDecisions ?? [], errors);

  const putXUser = (id: string, name: string, extra: Partial<CanonicalLegacyPlan["xUsers"][number]> = {}) => {
    const current = xUsers.get(id);
    xUsers.set(id, {
      id,
      x_name: current?.x_name || name || `@${id}`,
      icon_url: current?.icon_url ?? extra.icon_url ?? null,
      youtube_channel_url: current?.youtube_channel_url ?? extra.youtube_channel_url ?? null,
      other_social_links: current?.other_social_links ?? extra.other_social_links ?? null,
    });
  };

  for (const file of files) {
    file.rows.forEach((row, rowIndex) => {
      const source = `${file.name}:${rowIndex + 2 + (file.rowOffset ?? 0)}`;
      if (!isVideoRow(row)) {
        const id = (stringValue(row, "eventid") ?? "").replace(/^@+/, "");
        if (!id) {
          errors.push(`${source}: eventid がありません。`);
          return;
        }
        const title = stringValue(row, "eventname") ?? id;
        events.set(id, {
          id,
          title,
          event_type: eventType(stringValue(row, "type")),
          explanation: stringValue(row, "explanation"),
          icon_url: normalizeIconUrl(stringValue(row, "icon")),
          img_url: normalizeIconUrl(stringValue(row, "img")),
          visibility_status: options.eventVisibility,
          start_time: toUnixSec(row.start),
          end_time: toUnixSec(row.end),
        });

        const names = splitList(row.member);
        const ids = splitList(row.memberid);
        const roles = splitList(row.memberpost ?? row.menberpost);
        if (new Set([names.length, ids.length, roles.length]).size > 1) {
          warnings.push(
            `${source}: member/memberid/memberpost の件数が一致しないため、同じ位置にある値だけを対応付けます。`,
          );
        }
        const count = Math.max(names.length, ids.length, roles.length);
        let ownerAssigned = false;
        for (let index = 0; index < count; index += 1) {
          const xUserId = normalizeXId(ids[index] ?? null);
          if (!xUserId) {
            if (ids[index]) warnings.push(`${source}: memberid「${ids[index]}」を無視しました。`);
            continue;
          }
          const displayName = names[index] || `@${xUserId}`;
          const publicRole = roles[index] || null;
          const ownerHint = /主催|代表|統括|owner/i.test(publicRole ?? "");
          const permission = !ownerAssigned && (ownerHint || index === 0) ? "owner" : "public_staff";
          if (permission === "owner") ownerAssigned = true;
          const key = `${id}:${xUserId}`;
          staff.set(key, {
            id: stableId("staff_imp", key),
            event_id: id,
            x_user_id: xUserId,
            display_name: displayName,
            permission_preset: permission,
            is_public: publicRole ? 1 : 0,
            public_role_label: publicRole,
          });
          putXUser(xUserId, displayName);
        }
        if (count > 0 && !ownerAssigned) errors.push(`${source}: ownerにできるmemberidがありません。`);
        return;
      }

      const title = stringValue(row, "title") ?? "無題";
      const creatorName = stringValue(row, "creator") ?? "anonymous";
      const creatorXId = normalizeXId(stringValue(row, "tlink"));
      const youtubeId = extractYoutubeId(stringValue(row, "ylink"));
      const eventIds = splitList(row.eventid).map((value) => value.replace(/^@+/, "")).filter(Boolean);
      const videoId = youtubeId
        ? `legacy_${youtubeId}`
        : stableId("legacy_video", [eventIds.join(","), creatorXId ?? "", title, stringValue(row, "ylink") ?? ""].join("|"));
      if (videos.has(videoId)) {
        errors.push(`${source}: 作品ID ${videoId} が入力内で重複しています。`);
        return;
      }
      if (creatorXId) {
        putXUser(creatorXId, creatorName, {
          icon_url: normalizeIconUrl(stringValue(row, "icon")),
          youtube_channel_url: normalizeUrl(stringValue(row, "ychlink")),
          other_social_links: normalizeUrl(stringValue(row, "othersns")) ?? stringValue(row, "othersns"),
        });
      } else if (stringValue(row, "tlink")) {
        warnings.push(`${source}: tlinkをX IDとして解釈できませんでした。`);
      }

      const memberNames = splitList(row.member);
      const memberIds = splitList(row.memberid);
      const memberCount = Math.max(memberNames.length, memberIds.length);
      for (let index = 0; index < memberCount; index += 1) {
        const xUserId = normalizeXId(memberIds[index] ?? null);
        const name = memberNames[index] || (xUserId ? `@${xUserId}` : "");
        if (!name && !xUserId) continue;
        const memberId = stableId("member_imp", `${videoId}:${index}:${xUserId ?? name}`);
        members.set(memberId, {
          id: memberId,
          video_id: videoId,
          x_user_id: xUserId,
          name: name || `@${xUserId}`,
          role: null,
          order_index: index,
        });
        if (xUserId) putXUser(xUserId, name || `@${xUserId}`);
      }

      const chapterSource = row.starts ?? row.memberchapter;
      const chapterValues = memberStarts(chapterSource);
      if (chapterValues.length > 0 && chapterValues.length !== memberCount) {
        warnings.push(
          `${source}: member/memberid と memberchapter/starts の件数が一致しないため、先頭から順に対応付け、足りない側は空欄として保持します。`,
        );
      }
      chapterValues.forEach((start, index) => {
        if (start == null) {
          warnings.push(`${source}: memberchapter/starts の${index + 1}番目を時刻として解釈できませんでした。`);
          return;
        }
        const xUserId = normalizeXId(memberIds[index] ?? null);
        const name = memberNames[index] || (xUserId ? `@${xUserId}` : "");
        const chapterId = stableId("chapter_imp", `${videoId}:${index}:${start}`);
        chapters.set(chapterId, {
          id: chapterId,
          video_id: videoId,
          x_user_id: xUserId,
          chapter_time: start,
          chapter_label: name,
          note: null,
          visibility: "public",
        });
      });

      const generalComment = stringValue(row, "comment");
      const beforeComment = stringValue(row, "beforecomment");
      const legacyNotes = [
        ["ステージ利用", stringValue(row, "righttype")],
        ["登壇", stringValue(row, "toudan")],
        ["制作経験", stringValue(row, "movieyear")],
        ["コメント", beforeComment ? generalComment : null],
      ]
        .filter((item): item is [string, string] => !!item[1])
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n");
      const highlights = [stringValue(row, "hitokoto"), stringValue(row, "ycomment")]
        .filter((value): value is string => !!value)
        .join("\n") || null;
      const createdAt = toUnixSec(row.timestamp) ?? scheduledTime(row) ?? now;
      videos.set(videoId, {
        id: videoId,
        primary_event_id: eventIds[0] ?? null,
        creator_x_user_id: creatorXId,
        collaboration_type: memberCount > 1 || /collab|合作|複数|団体/i.test(
          [stringValue(row, "type2"), stringValue(row, "type")].filter(Boolean).join(" "),
        )
          ? "collab"
          : "individual",
        source_type: youtubeId ? "youtube" : "external",
        creator_display_name: creatorName,
        creator_display_name_yomi: stringValue(row, "yomi"),
        creator_icon_url: normalizeIconUrl(stringValue(row, "icon")),
        creator_youtube_channel_url: normalizeUrl(stringValue(row, "ychlink")),
        title,
        music: stringValue(row, "music"),
        credit: stringValue(row, "credit"),
        music_reference_url: normalizeUrl(stringValue(row, "ymulink")),
        closing_comment: stringValue(row, "aftercomment"),
        youtube_video_id: youtubeId,
        intro_comment: beforeComment ?? generalComment,
        highlights,
        production_story: legacyNotes || null,
        visibility_status: options.videoVisibility,
        scheduling_type: "manual",
        scheduled_time: scheduledTime(row),
        created_at: createdAt,
      });
      eventIds.forEach((eventId) => {
        videoEvents.set(`${videoId}:${eventId}`, { video_id: videoId, event_id: eventId });
      });

      Object.keys(row).sort().forEach((sourceKey) => {
        if (CANONICAL_VIDEO_SOURCE_KEYS.has(sourceKey)) return;
        const rawAnswer = row[sourceKey];
        if (rawAnswer !== null && typeof rawAnswer === "object") {
          errors.push(
            `${source}: 動画の未対応項目「${sourceKey}」は配列またはオブジェクトのため取り込めません。`,
          );
          return;
        }
        const answerText = textValue(rawAnswer);
        if (!answerText) return;
        if (sourceKey.length > 120 || /[\u0000-\u001F\u007F]/.test(sourceKey)) {
          errors.push(`${source}: 動画の未対応項目名が長すぎるか制御文字を含んでいます。`);
          return;
        }

        const customDecision = fieldDecisions.customQuestions.get(sourceKey);
        if (customDecision) {
          seenDecisionSourceKeys.add(sourceKey);
          seenCustomSourceKeys.add(sourceKey);
          if (answerText.length > MAX_CUSTOM_ANSWER_LENGTH) {
            errors.push(
              `${source}: 動画項目「${sourceKey}」の回答は${MAX_CUSTOM_ANSWER_LENGTH}文字以内にしてください。`,
            );
            return;
          }
          if (eventIds.length === 0) {
            errors.push(
              `${source}: 動画項目「${sourceKey}」をカスタム質問へ保存するにはeventidが必要です。`,
            );
            return;
          }
          const questionKey = legacyQuestionKey(sourceKey);
          eventIds.forEach((eventId) => {
            const questionMapKey = `${eventId}:${questionKey}`;
            const questionId = stableId("ecq_imp", questionMapKey);
            const currentQuestion = eventCustomQuestions.get(questionMapKey);
            if (currentQuestion && currentQuestion.source_key !== sourceKey) {
              errors.push(
                `動画項目「${sourceKey}」と「${currentQuestion.source_key}」の質問識別子が衝突しました。`,
              );
              return;
            }
            eventCustomQuestions.set(questionMapKey, {
              id: questionId,
              event_id: eventId,
              source_key: sourceKey,
              question_key: questionKey,
              label: customDecision.label,
              description: `旧形式インポート元項目: ${sourceKey}`,
              type: "textarea",
              required: 0,
              options_json: null,
              placeholder: null,
              max_length: 1000,
              sort_order: 1000 + customDecision.sortOrder,
              is_active: 1,
              visibility: "review",
            });
            videoCustomAnswers.set(`${videoId}:${eventId}:${questionId}`, {
              video_id: videoId,
              event_id: eventId,
              question_id: questionId,
              question_key: questionKey,
              answer_text: answerText,
              answer_json: null,
            });
          });
          return;
        }

        if (fieldDecisions.ignored.has(sourceKey)) {
          seenDecisionSourceKeys.add(sourceKey);
          ignoredFieldCounts.set(sourceKey, (ignoredFieldCounts.get(sourceKey) ?? 0) + 1);
          return;
        }
        seenDecisionSourceKeys.add(sourceKey);
        autoIgnoredFieldCounts.set(sourceKey, (autoIgnoredFieldCounts.get(sourceKey) ?? 0) + 1);
      });

      splitList(row.soft)
        .filter(Boolean)
        .forEach((label) => softwares.set(`${videoId}:${label.toLowerCase()}`, { video_id: videoId, label }));
    });
  }

  for (const sourceKey of fieldDecisions.customQuestions.keys()) {
    if (!seenCustomSourceKeys.has(sourceKey)) {
      errors.push(`動画項目「${sourceKey}」にはカスタム質問へ保存できる非空値がありません。`);
    }
  }
  for (const sourceKey of fieldDecisions.ignored) {
    if (!seenDecisionSourceKeys.has(sourceKey)) {
      errors.push(`動画項目「${sourceKey}」には除外対象の非空値がありません。`);
    }
  }
  if (autoIgnoredFieldCounts.size > MAX_LEGACY_VIDEO_FIELD_DECISIONS) {
    errors.push(`正規カラムに対応しない動画項目は最大${MAX_LEGACY_VIDEO_FIELD_DECISIONS}件です。`);
  }
  for (const [sourceKey, count] of ignoredFieldCounts) {
    warnings.push(`動画項目「${sourceKey}」の非空値${count}件を指定どおり取り込み対象外にしました。`);
  }
  for (const [sourceKey, count] of autoIgnoredFieldCounts) {
    warnings.push(
      `動画項目「${sourceKey}」の非空値${count}件は未指定のため取り込み対象外としました。カスタム質問へ保存する場合は再度プレビューしてください。`,
    );
  }

  const customAnswerCounts = new Map<string, number>();
  for (const answer of videoCustomAnswers.values()) {
    customAnswerCounts.set(answer.video_id, (customAnswerCounts.get(answer.video_id) ?? 0) + 1);
  }
  for (const [videoId, count] of customAnswerCounts) {
    if (count > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO) {
      errors.push(
        `作品 ${videoId} のカスタム質問回答はイベント別の複製を含めて最大${MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO}件です。`,
      );
    }
  }

  const referencedEventIds = new Set<string>();
  for (const video of videos.values()) {
    if (video.primary_event_id) referencedEventIds.add(video.primary_event_id);
  }
  for (const link of videoEvents.values()) {
    referencedEventIds.add(link.event_id);
  }
  for (const question of eventCustomQuestions.values()) {
    referencedEventIds.add(question.event_id);
  }

  for (const eventId of [...referencedEventIds].sort()) {
    if (events.has(eventId)) continue;

    const referencingVideoIds = new Set<string>();
    for (const link of videoEvents.values()) {
      if (link.event_id === eventId) referencingVideoIds.add(link.video_id);
    }
    for (const video of videos.values()) {
      if (video.primary_event_id === eventId) referencingVideoIds.add(video.id);
    }

    events.set(eventId, {
      id: eventId,
      title: eventId,
      event_type: "event",
      explanation: "動画ファイルの参照により自動作成されました。",
      icon_url: null,
      img_url: null,
      visibility_status: options.eventVisibility,
      start_time: null,
      end_time: null,
    });
    warnings.push(`イベント ${eventId} は動画参照のため自動作成します`);

    let ownerXId: string | null = null;
    let ownerDisplayName = "";
    for (const videoId of referencingVideoIds) {
      const video = videos.get(videoId);
      if (video?.creator_x_user_id) {
        ownerXId = video.creator_x_user_id;
        ownerDisplayName = video.creator_display_name;
        break;
      }
    }
    if (!ownerXId) {
      const orderedMembers = [...members.values()]
        .filter((member) => referencingVideoIds.has(member.video_id) && member.x_user_id)
        .sort(
          (left, right) =>
            left.video_id.localeCompare(right.video_id) || left.order_index - right.order_index,
        );
      const member = orderedMembers[0];
      if (member?.x_user_id) {
        ownerXId = member.x_user_id;
        ownerDisplayName = member.name;
      }
    }
    if (!ownerXId) {
      ownerXId = placeholderOwnerXId(eventId);
      ownerDisplayName = `@${ownerXId}`;
      putXUser(ownerXId, ownerDisplayName);
    } else {
      putXUser(ownerXId, ownerDisplayName || `@${ownerXId}`);
    }

    const staffKey = `${eventId}:${ownerXId}`;
    staff.set(staffKey, {
      id: stableId("staff_imp", staffKey),
      event_id: eventId,
      x_user_id: ownerXId,
      display_name: ownerDisplayName || `@${ownerXId}`,
      permission_preset: "owner",
      is_public: 0,
      public_role_label: null,
    });
  }

  const unmappedVideoFields = [...autoIgnoredFieldCounts]
    .map(([source_key, non_empty_rows]) => ({ source_key, non_empty_rows }))
    .sort((left, right) => left.source_key.localeCompare(right.source_key));
  const sortedCustomQuestions = [...eventCustomQuestions.values()].sort(
    (left, right) =>
      left.event_id.localeCompare(right.event_id) || left.source_key.localeCompare(right.source_key),
  );
  const sortedCustomAnswers = [...videoCustomAnswers.values()].sort(
    (left, right) =>
      left.video_id.localeCompare(right.video_id) ||
      left.event_id.localeCompare(right.event_id) ||
      left.question_id.localeCompare(right.question_id),
  );
  const normalizedFieldDecisions: LegacyVideoFieldDecision[] = [
    ...[...fieldDecisions.customQuestions].map(([source_key, value]) => ({
      source_key,
      action: "custom_question" as const,
      question_label: value.label,
    })),
    ...[...fieldDecisions.ignored].map((source_key) => ({
      source_key,
      action: "ignore" as const,
    })),
  ].sort((left, right) => left.source_key.localeCompare(right.source_key));

  return {
    events: [...events.values()],
    eventStaff: [...staff.values()],
    xUsers: [...xUsers.values()],
    videos: [...videos.values()],
    videoEvents: [...videoEvents.values()],
    videoMembers: [...members.values()],
    videoChapters: [...chapters.values()],
    videoSoftwares: [...softwares.values()],
    eventCustomQuestions: sortedCustomQuestions,
    videoCustomAnswers: sortedCustomAnswers,
    videoFieldDecisions: normalizedFieldDecisions,
    unmappedVideoFields,
    warnings,
    errors,
  };
}
