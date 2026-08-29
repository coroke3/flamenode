import { FORBIDDEN_PUBLIC_KEYS } from "./publicDto.ts";

export type EventExportFormat = "v5" | "legacy";
export type EventExportUpdateMode = "realtime" | "scheduled";

export interface EventExportStaffSnapshot {
  x_user_id: string | null;
  display_name: string;
  public_role_label: string | null;
  x_name: string | null;
  icon_url: string | null;
}

export interface EventExportEventSnapshot {
  id: string;
  title: string;
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  event_type: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  updated_at: number;
  public_staff: EventExportStaffSnapshot[];
}

export interface EventExportMemberSnapshot {
  x_user_id: string | null;
  name: string;
  role_label: string | null;
  order_index: number;
}

export interface EventExportSoftwareSnapshot {
  name: string;
  raw_label: string;
  order_index: number;
}

export interface EventExportAnswerSnapshot {
  key: string;
  label: string;
  answer_text: string | null;
  answer_json: string | null;
  sort_order: number;
}

export interface EventExportChapterSnapshot {
  id: string;
  x_user_id: string | null;
  chapter_time: number;
  chapter_label: string;
  note: string | null;
}

export interface EventExportVideoSnapshot {
  id: string;
  title: string;
  primary_event_id: string | null;
  collaboration_type: string;
  part: string | null;
  source_type: string;
  creator_display_name: string;
  creator_display_name_yomi: string | null;
  creator_x_user_id: string | null;
  creator_icon_url: string | null;
  creator_youtube_channel_url: string | null;
  creator_profile_text: string | null;
  creator_other_social_links: string | null;
  music: string | null;
  credit: string | null;
  music_reference_url: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  closing_comment: string | null;
  youtube_video_id: string | null;
  scheduled_time: number | null;
  app_like_count: number;
  score: number;
  created_at: number;
  updated_at: number;
  event_ids: string[];
  members: EventExportMemberSnapshot[];
  softwares: EventExportSoftwareSnapshot[];
  answers: EventExportAnswerSnapshot[];
  chapters: EventExportChapterSnapshot[];
}

export interface EventExportSnapshot {
  event: EventExportEventSnapshot;
  videos: EventExportVideoSnapshot[];
  limit: number;
  truncated: boolean;
}

function youtubeUrl(id: string | null): string | null {
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function youtubeThumbnail(
  id: string | null,
  size: "medium" | "large",
): string | null {
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/${
    size === "large" ? "maxresdefault" : "mqdefault"
  }.jpg`;
}

function xProfileUrl(xId: string | null): string | null {
  return xId ? `https://x.com/${encodeURIComponent(xId)}` : null;
}

function isoFromUnix(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

/**
 * `answer_json` is currently written only for checkbox questions, where the
 * value is a JSON array of strings.  Do not deserialize an arbitrary object
 * from a legacy/corrupted row into a public payload: custom answers are user
 * controlled and an object could carry an internal key such as `user_id`.
 */
function parsePublicAnswerJson(value: string | null): string[] | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Profile social links historically accepted both an object map and the
 * newer array form.  Keep that public shape for compatibility, but remove
 * forbidden keys recursively before serializing arbitrary legacy JSON.
 */
function sanitizePublicJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePublicJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !FORBIDDEN_PUBLIC_KEYS.has(key))
      .map(([key, nested]) => [key, sanitizePublicJson(nested)]),
  );
}

function parsePublicJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return sanitizePublicJson(JSON.parse(value) as unknown);
  } catch {
    return value;
  }
}

function legacyPublicJsonText(value: string | null): string {
  const parsed = parsePublicJson(value);
  if (parsed == null) return "";
  if (typeof parsed === "string") return parsed;
  try {
    return JSON.stringify(parsed);
  } catch {
    return "";
  }
}

function answerValue(answer: EventExportAnswerSnapshot): unknown {
  return answer.answer_json
    ? parsePublicAnswerJson(answer.answer_json)
    : answer.answer_text;
}

function answerText(video: EventExportVideoSnapshot, key: string): string {
  const answer = video.answers.find((candidate) => candidate.key === key);
  if (!answer) return "";
  const value = answerValue(answer);
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(",");
  return "";
}

interface EventExportCustomAnswer {
  key: string;
  label: string;
  value: unknown;
  order: number;
}

function buildCustomAnswers(
  video: EventExportVideoSnapshot,
): EventExportCustomAnswer[] {
  return video.answers.map((answer) => ({
    key: answer.key,
    label: answer.label,
    value: answerValue(answer),
    order: answer.sort_order,
  }));
}

function buildCustomAnswersByKey(
  answers: readonly EventExportCustomAnswer[],
): Record<string, unknown> {
  return Object.fromEntries(
    answers
      .filter((answer) => !FORBIDDEN_PUBLIC_KEYS.has(answer.key))
      .map((answer) => [answer.key, answer.value]),
  );
}

/** Legacy rows are flat: never let a question key replace compatibility data. */
const LEGACY_RESERVED_KEYS: ReadonlySet<string> = new Set([
  "id", "eventid", "timestamp", "type1", "type2", "type", "creator",
  "yomi", "movieyear", "tlink", "ychlink", "icon", "member", "memberid",
  "memberchapter", "data", "time", "title", "music", "credit", "ymulink",
  "up", "othersns", "righttype", "comment", "ylink", "", "beforecomment",
  "aftercomment", "soft", "toudan", "hitokoto", "starts", "ends", "startm",
  "endm", "ycomment", "status", "small", "largeThumbnail", "link", "fu",
  "custom_answers", "custom_answers_by_key", "__proto__", "constructor", "prototype",
]);

function isSafeLegacyCustomAnswerKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(key) &&
    !FORBIDDEN_PUBLIC_KEYS.has(key) &&
    !LEGACY_RESERVED_KEYS.has(key)
  );
}

function buildLegacyCustomAnswerFields(
  answers: readonly EventExportCustomAnswer[],
): Record<string, unknown> {
  const fields = Object.create(null) as Record<string, unknown>;
  for (const answer of answers) {
    if (!isSafeLegacyCustomAnswerKey(answer.key)) continue;
    fields[answer.key] = answer.value;
  }
  return fields;
}

function legacyDateParts(value: number | null): { date: string; time: string } {
  if (value == null || !Number.isFinite(value)) return { date: "", time: "" };
  const date = new Date((value + 9 * 60 * 60) * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return { date: `${month}/${day}`, time: `${hour}:${minute}` };
}

type LegacyImportedNoteKey = "ステージ利用" | "登壇" | "制作経験" | "コメント";

const LEGACY_IMPORTED_NOTE_RE = /^(ステージ利用|登壇|制作経験|コメント):\s?(.*)$/;

function isLegacyImportedVideo(video: EventExportVideoSnapshot): boolean {
  // normalizeLegacyFiles() が生成するIDは legacy_<youtube id> または
  // legacy_video_<hash>。通常作品のproduction_storyを旧メタデータとして
  // 誤解釈しないため、この由来が分かる作品だけ復元対象にする。
  return video.id.startsWith("legacy_");
}

function parseLegacyImportedNotes(
  video: EventExportVideoSnapshot,
): ReadonlyMap<LegacyImportedNoteKey, string> {
  const out = new Map<LegacyImportedNoteKey, string>();
  if (!isLegacyImportedVideo(video) || !video.production_story?.trim()) return out;

  let activeKey: LegacyImportedNoteKey | null = null;
  for (const line of video.production_story.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(LEGACY_IMPORTED_NOTE_RE);
    if (match) {
      activeKey = match[1] as LegacyImportedNoteKey;
      out.set(activeKey, match[2] ?? "");
      continue;
    }
    if (!activeKey) continue;
    const current = out.get(activeKey) ?? "";
    out.set(activeKey, current ? `${current}\n${line}` : line);
  }

  return out;
}

function earliestChapterTime(
  chapters: readonly EventExportChapterSnapshot[],
): string {
  let earliest: number | null = null;
  for (const chapter of chapters) {
    if (!Number.isFinite(chapter.chapter_time) || chapter.chapter_time < 0) continue;
    earliest =
      earliest == null
        ? chapter.chapter_time
        : Math.min(earliest, chapter.chapter_time);
  }
  return earliest == null ? "" : String(earliest);
}

function firstMemberChapter(
  video: EventExportVideoSnapshot,
  member: EventExportMemberSnapshot,
): string {
  const memberName = member.name.trim();
  return earliestChapterTime(
    video.chapters.filter((chapter) => {
      if (member.x_user_id) return chapter.x_user_id === member.x_user_id;
      return (
        chapter.x_user_id == null &&
        memberName.length > 0 &&
        chapter.chapter_label.trim() === memberName
      );
    }),
  );
}

function legacyStarts(video: EventExportVideoSnapshot): string {
  if (video.members.length > 0) {
    return video.members
      .map((member) => firstMemberChapter(video, member))
      .join(",");
  }

  // メンバーがない通常作品のchapterを旧 `starts` とみなす根拠はない。
  // legacy import由来だけは importer が旧startsをpublic chapterへ変換するため復元できる。
  if (!isLegacyImportedVideo(video)) return "";
  return earliestChapterTime(
    video.chapters.filter(
      (chapter) =>
        chapter.x_user_id == null ||
        (video.creator_x_user_id != null &&
          chapter.x_user_id === video.creator_x_user_id),
    ),
  );
}

/**
 * 旧EventArchives系の公開JSON互換アダプター。
 * DB旧形式を復活させず、現在の公開snapshotから安全に再構成できる値だけを返す。
 * `ends` / `startm` / `endm` はcanonical schemaに復元元がないため推測しない。
 */
export function buildLegacyEventExportPayload(
  snapshot: EventExportSnapshot,
): Array<Record<string, unknown>> {
  return snapshot.videos.map((video) => {
    const schedule = legacyDateParts(video.scheduled_time);
    const isCollaboration =
      video.collaboration_type === "collab" || video.members.length > 1;
    const customAnswers = buildCustomAnswers(video);
    const customAnswersByKey = buildCustomAnswersByKey(customAnswers);
    const starts = legacyStarts(video);
    const emptyMemberAligned = video.members.map(() => "").join(",");
    const importedNotes = parseLegacyImportedNotes(video);
    const productionExperience =
      answerText(video, "production_experience") ||
      importedNotes.get("制作経験") ||
      "";
    const stagePermission =
      answerText(video, "stage_permission") ||
      importedNotes.get("ステージ利用") ||
      "";
    const stageParticipation =
      answerText(video, "stage_participation") ||
      importedNotes.get("登壇") ||
      "";
    const legacyGeneralComment = importedNotes.get("コメント") || video.intro_comment || "";

    return {
      ...buildLegacyCustomAnswerFields(customAnswers),
      id: video.id,
      eventid: snapshot.event.id,
      timestamp:
        isoFromUnix(video.created_at) ?? isoFromUnix(video.scheduled_time) ?? "",
      type1: isCollaboration ? "複数人" : "個人",
      type2: isCollaboration ? "団体" : "個人",
      type: video.part ?? "",
      creator: video.creator_display_name,
      yomi: video.creator_display_name_yomi ?? "",
      movieyear: productionExperience,
      tlink: video.creator_x_user_id ?? "",
      ychlink: video.creator_youtube_channel_url ?? "",
      icon: video.creator_icon_url ?? "",
      member: video.members.map((member) => member.name).join(","),
      memberid: video.members
        .map((member) => (member.x_user_id ? `@${member.x_user_id}` : ""))
        .join(","),
      data: schedule.date,
      time: schedule.time,
      title: video.title,
      music: video.music ?? "",
      credit: video.credit ?? "",
      ymulink: video.music_reference_url ?? "",
      up: "",
      othersns: legacyPublicJsonText(video.creator_other_social_links),
      righttype: stagePermission,
      comment: legacyGeneralComment,
      ylink: youtubeUrl(video.youtube_video_id) ?? "",
      "": "",
      beforecomment: video.intro_comment ?? "",
      aftercomment: video.closing_comment ?? "",
      soft: video.softwares
        .map((software) => software.raw_label || software.name)
        .filter(Boolean)
        .join(","),
      toudan: stageParticipation,
      hitokoto: video.highlights ?? "",
      starts,
      ends: emptyMemberAligned,
      startm: "",
      endm: "",
      ycomment: video.highlights ?? "",
      status: "public",
      small: youtubeThumbnail(video.youtube_video_id, "medium") ?? "",
      largeThumbnail: youtubeThumbnail(video.youtube_video_id, "large") ?? "",
      link: xProfileUrl(video.creator_x_user_id) ?? "",
      fu: video.part ?? "",
      custom_answers: customAnswers,
      custom_answers_by_key: customAnswersByKey,
    };
  });
}

/** FlameNodeイベント公開API v5。DB正本の概念を構造化して返す。 */
export function buildEventExportPayload(
  snapshot: EventExportSnapshot,
  generatedAt = Math.floor(Date.now() / 1000),
  updateMode: EventExportUpdateMode = "realtime",
) {
  return {
    schema_version: 5,
    format: "flamenode-event-export" as const,
    generated_at: isoFromUnix(generatedAt),
    generated_at_unix: generatedAt,
    update_mode: updateMode,
    event: {
      id: snapshot.event.id,
      title: snapshot.event.title,
      explanation: snapshot.event.explanation,
      status: "public" as const,
      icon_url: snapshot.event.icon_url,
      image_url: snapshot.event.img_url,
      accent_color: snapshot.event.accent_color,
      event_type: snapshot.event.event_type,
      start_at: isoFromUnix(snapshot.event.start_time),
      end_at: isoFromUnix(snapshot.event.end_time),
      entry_start_at: isoFromUnix(snapshot.event.entry_start_time),
      entry_end_at: isoFromUnix(snapshot.event.entry_end_time),
      updated_at: isoFromUnix(snapshot.event.updated_at),
      unix_time: {
        start: snapshot.event.start_time,
        end: snapshot.event.end_time,
        entry_start: snapshot.event.entry_start_time,
        entry_end: snapshot.event.entry_end_time,
        updated: snapshot.event.updated_at,
      },
      public_staff: snapshot.event.public_staff.map((staff) => ({
        display_name: staff.display_name,
        role_label: staff.public_role_label,
        x_id: staff.x_user_id,
        x_name: staff.x_name,
        x_url: xProfileUrl(staff.x_user_id),
        icon_url: staff.icon_url,
      })),
    },
    videos: snapshot.videos.map((video) => {
      const customAnswers = buildCustomAnswers(video);
      const customAnswersByKey = buildCustomAnswersByKey(customAnswers);
      return {
        id: video.id,
        title: video.title,
        status: "public" as const,
        primary_event_id: video.primary_event_id,
        event_ids: video.event_ids,
        collaboration_type: video.collaboration_type,
        participant_scope:
          video.collaboration_type === "collab" || video.members.length > 1
            ? ("group" as const)
            : ("individual" as const),
        part: video.part,
        source: {
          type: video.source_type,
          youtube_video_id: video.youtube_video_id,
          youtube_url: youtubeUrl(video.youtube_video_id),
          thumbnail_url: youtubeThumbnail(video.youtube_video_id, "large"),
          thumbnails: {
            medium_url: youtubeThumbnail(video.youtube_video_id, "medium"),
            large_url: youtubeThumbnail(video.youtube_video_id, "large"),
          },
        },
        creator: {
          display_name: video.creator_display_name,
          display_name_yomi: video.creator_display_name_yomi,
          x_id: video.creator_x_user_id,
          x_url: xProfileUrl(video.creator_x_user_id),
          icon_url: video.creator_icon_url,
          profile_text: video.creator_profile_text,
          youtube_channel_url: video.creator_youtube_channel_url,
          other_social_links: parsePublicJson(video.creator_other_social_links),
        },
        music: {
          title: video.music,
          credit: video.credit,
          reference_url: video.music_reference_url,
        },
        comments: {
          introduction: video.intro_comment,
          highlights: video.highlights,
          production_story: video.production_story,
          closing: video.closing_comment,
        },
        scheduled_at: isoFromUnix(video.scheduled_time),
        created_at: isoFromUnix(video.created_at),
        updated_at: isoFromUnix(video.updated_at),
        unix_time: {
          scheduled: video.scheduled_time,
          created: video.created_at,
          updated: video.updated_at,
        },
        stats: {
          app_likes: video.app_like_count,
          score: video.score,
        },
        members: video.members.map((member) => ({
          name: member.name,
          x_id: member.x_user_id,
          x_url: xProfileUrl(member.x_user_id),
          role_label: member.role_label,
          order: member.order_index,
        })),
        chapters: video.chapters.map((chapter) => ({
          id: chapter.id,
          time_seconds: chapter.chapter_time,
          label: chapter.chapter_label,
          note: chapter.note,
          author: {
            x_id: chapter.x_user_id,
            x_url: xProfileUrl(chapter.x_user_id),
          },
        })),
        softwares: video.softwares.map((software) => ({
          name: software.name,
          source_label: software.raw_label,
          order: software.order_index,
        })),
        custom_answers: customAnswers,
        custom_answers_by_key: customAnswersByKey,
      };
    }),
    meta: {
      count: snapshot.videos.length,
      limit: snapshot.limit,
      truncated: snapshot.truncated,
    },
  };
}

export function buildEventExportPayloadForFormat(
  snapshot: EventExportSnapshot,
  format: EventExportFormat,
  generatedAt = Math.floor(Date.now() / 1000),
  updateMode: EventExportUpdateMode = "realtime",
): unknown {
  return format === "legacy"
    ? buildLegacyEventExportPayload(snapshot)
    : buildEventExportPayload(snapshot, generatedAt, updateMode);
}
