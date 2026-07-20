export type EventExportFormat = "legacy" | "new";
export type EventExportUpdateMode = "realtime" | "scheduled";

export interface EventExportStaffSnapshot {
  x_user_id: string;
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
}

export interface EventExportAnswerSnapshot {
  key: string;
  label: string;
  answer_text: string | null;
  answer_json: string | null;
  sort_order: number;
}

export interface EventExportChapterSnapshot {
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

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function answerValue(answer: EventExportAnswerSnapshot): unknown {
  return answer.answer_json ? parseJson(answer.answer_json) : answer.answer_text;
}

function answerText(video: EventExportVideoSnapshot, key: string): string {
  const answer = video.answers.find((candidate) => candidate.key === key);
  if (!answer) return "";
  const value = answerValue(answer);
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function legacyDateParts(value: number | null): {
  date: string;
  time: string;
} {
  if (value == null || !Number.isFinite(value)) {
    return { date: "", time: "" };
  }
  const date = new Date((value + 9 * 60 * 60) * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return { date: `${month}/${day}`, time: `${hour}:${minute}` };
}

/** 旧形式は入力互換用の公開データだけを再構成し、旧DB列へ依存しない。 */
export function buildLegacyEventExportPayload(
  snapshot: EventExportSnapshot,
): Array<Record<string, unknown>> {
  return snapshot.videos.map((video) => {
    const schedule = legacyDateParts(video.scheduled_time);
    const isCollaboration =
      video.collaboration_type === "collab" || video.members.length > 1;
    const chapterTimes = video.chapters
      .map((chapter) => chapter.chapter_time)
      .filter((time) => Number.isFinite(time) && time >= 0)
      .map(String);

    return {
      id: video.id,
      eventid: snapshot.event.id,
      timestamp:
        isoFromUnix(video.created_at) ?? isoFromUnix(video.scheduled_time) ?? "",
      type1: isCollaboration ? "複数人" : "個人",
      type2: isCollaboration ? "団体" : "個人",
      type: video.part ?? "",
      creator: video.creator_display_name,
      yomi: video.creator_display_name_yomi ?? "",
      movieyear: answerText(video, "production_experience"),
      tlink: video.creator_x_user_id ?? "",
      ychlink: video.creator_youtube_channel_url ?? "",
      icon: video.creator_icon_url ?? "",
      member: video.members.map((member) => member.name).join(","),
      memberid: video.members
        .map((member) => (member.x_user_id ? `@${member.x_user_id}` : ""))
        .join(","),
      memberchapter: chapterTimes.join(","),
      data: schedule.date,
      time: schedule.time,
      title: video.title,
      music: video.music ?? "",
      credit: video.credit ?? "",
      ymulink: video.music_reference_url ?? "",
      up: "",
      othersns: video.creator_other_social_links ?? "",
      righttype: answerText(video, "stage_permission"),
      comment: video.intro_comment ?? "",
      ylink: youtubeUrl(video.youtube_video_id) ?? "",
      "": "",
      beforecomment: video.intro_comment ?? "",
      aftercomment: video.closing_comment ?? "",
      soft: video.softwares
        .map((software) => software.raw_label || software.name)
        .filter(Boolean)
        .join(","),
      toudan: answerText(video, "stage_participation"),
      hitokoto: video.highlights ?? "",
      starts: chapterTimes.join(","),
      ends: "",
      startm: "",
      endm: "",
      ycomment: video.highlights ?? "",
      status: "public",
      small: youtubeThumbnail(video.youtube_video_id, "medium") ?? "",
      largeThumbnail: youtubeThumbnail(video.youtube_video_id, "large") ?? "",
      link: xProfileUrl(video.creator_x_user_id) ?? "",
      fu: video.part ?? "",
    };
  });
}

export function buildEventExportPayload(
  snapshot: EventExportSnapshot,
  generatedAt = Math.floor(Date.now() / 1000),
  updateMode: EventExportUpdateMode = "realtime",
) {
  return {
    schema_version: 3,
    format: "flamenode-event-export",
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
      const customAnswers = video.answers.map((answer) => ({
        key: answer.key,
        label: answer.label,
        value: answerValue(answer),
        order: answer.sort_order,
      }));
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
          youtube_channel_url: video.creator_youtube_channel_url,
          other_social_links: parseJson(video.creator_other_social_links),
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
        chapters: video.chapters.map((chapter, index) => ({
          time_seconds: chapter.chapter_time,
          label: chapter.chapter_label,
          note: chapter.note,
          order: index,
          author: {
            x_id: chapter.x_user_id,
            x_url: xProfileUrl(chapter.x_user_id),
          },
        })),
        softwares: video.softwares.map((software, index) => ({
          name: software.name,
          source_label: software.raw_label,
          order: index,
        })),
        custom_answers: customAnswers,
        custom_answers_by_key: Object.fromEntries(
          customAnswers.map((answer) => [answer.key, answer.value]),
        ),
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
