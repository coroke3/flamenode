export type EventExportFormat = "legacy" | "new";
export type EventExportUpdateMode = "realtime" | "scheduled";

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
}

export interface EventExportMemberSnapshot {
  x_user_id: string | null;
  name: string;
  role_label: string | null;
  order_index: number;
  chapters_json: string | null;
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
  members: EventExportMemberSnapshot[];
  softwares: EventExportSoftwareSnapshot[];
  answers: EventExportAnswerSnapshot[];
}

export interface EventExportSnapshot {
  event: EventExportEventSnapshot;
  videos: EventExportVideoSnapshot[];
  limit: number;
  truncated: boolean;
}

function youtubeUrl(id: string | null): string {
  return id ? `https://www.youtube.com/watch?v=${id}` : "";
}

function youtubeThumbnail(id: string | null, large = false): string {
  if (!id) return "";
  return `https://i.ytimg.com/vi/${id}/${large ? "maxresdefault" : "mqdefault"}.jpg`;
}

function xProfileUrl(xId: string | null): string {
  return xId ? `https://x.com/${encodeURIComponent(xId)}` : "";
}

function isoFromUnix(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
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

function parseAnswerJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function firstChapterTime(chaptersJson: string | null): string {
  if (!chaptersJson) return "";
  try {
    const parsed = JSON.parse(chaptersJson) as Array<{ time_seconds?: unknown }>;
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    const value = Number(first?.time_seconds);
    return Number.isFinite(value) && value >= 0 ? String(value) : "";
  } catch {
    return "";
  }
}

function buildLegacyRows(snapshot: EventExportSnapshot): Array<Record<string, unknown>> {
  return snapshot.videos.map((video) => {
    const schedule = legacyDateParts(video.scheduled_time);
    const memberNames = video.members.map((member) => member.name).join(",");
    const memberIds = video.members
      .map((member) => (member.x_user_id ? `@${member.x_user_id}` : ""))
      .join(",");
    const starts = video.members.map((member) => firstChapterTime(member.chapters_json)).join(",");
    const software = video.softwares
      .map((item) => item.raw_label || item.name)
      .filter(Boolean)
      .join(",");
    const isCollaboration = video.collaboration_type === "collab" || video.members.length > 1;

    return {
      id: video.id,
      eventid: snapshot.event.id,
      timestamp: isoFromUnix(video.created_at) ?? isoFromUnix(video.scheduled_time) ?? "",
      type1: isCollaboration ? "複数人" : "個人",
      type2: isCollaboration ? "団体" : "個人",
      type: video.part ?? "",
      creator: video.creator_display_name,
      yomi: video.creator_display_name_yomi ?? "",
      movieyear: "",
      tlink: video.creator_x_user_id ?? "",
      ychlink: video.creator_youtube_channel_url ?? "",
      icon: video.creator_icon_url ?? "",
      member: memberNames,
      memberid: memberIds,
      data: schedule.date,
      time: schedule.time,
      title: video.title,
      music: video.music ?? "",
      credit: video.credit ?? "",
      ymulink: video.music_reference_url ?? "",
      up: "",
      othersns: video.creator_other_social_links ?? "",
      righttype: "",
      comment: video.intro_comment ?? "",
      ylink: youtubeUrl(video.youtube_video_id),
      "": "",
      beforecomment: video.intro_comment ?? "",
      aftercomment: video.closing_comment ?? "",
      soft: software,
      toudan: "",
      hitokoto: video.highlights ?? "",
      starts,
      ends: "",
      startm: "",
      endm: "",
      ycomment: video.highlights ?? "",
      status: "public",
      small: youtubeThumbnail(video.youtube_video_id),
      largeThumbnail: youtubeThumbnail(video.youtube_video_id, true),
      link: xProfileUrl(video.creator_x_user_id),
      fu: video.part ?? "",
    };
  });
}

function buildNewPayload(
  snapshot: EventExportSnapshot,
  generatedAt: number,
  updateMode: EventExportUpdateMode,
): Record<string, unknown> {
  return {
    schema_version: 2,
    format: "flamenode-event-export",
    generated_at: isoFromUnix(generatedAt),
    update_mode: updateMode,
    event: {
      id: snapshot.event.id,
      title: snapshot.event.title,
      explanation: snapshot.event.explanation,
      icon_url: snapshot.event.icon_url,
      image_url: snapshot.event.img_url,
      accent_color: snapshot.event.accent_color,
      event_type: snapshot.event.event_type,
      start_at: isoFromUnix(snapshot.event.start_time),
      end_at: isoFromUnix(snapshot.event.end_time),
      entry_start_at: isoFromUnix(snapshot.event.entry_start_time),
      entry_end_at: isoFromUnix(snapshot.event.entry_end_time),
      updated_at: isoFromUnix(snapshot.event.updated_at),
    },
    videos: snapshot.videos.map((video) => ({
      id: video.id,
      title: video.title,
      status: "public",
      primary_event_id: video.primary_event_id,
      collaboration_type: video.collaboration_type,
      part: video.part,
      source: {
        type: video.source_type,
        youtube_video_id: video.youtube_video_id,
        youtube_url: youtubeUrl(video.youtube_video_id) || null,
        thumbnail_url: youtubeThumbnail(video.youtube_video_id, true) || null,
      },
      creator: {
        display_name: video.creator_display_name,
        display_name_yomi: video.creator_display_name_yomi,
        x_id: video.creator_x_user_id,
        x_url: xProfileUrl(video.creator_x_user_id) || null,
        icon_url: video.creator_icon_url,
        youtube_channel_url: video.creator_youtube_channel_url,
        other_social_links: parseAnswerJson(video.creator_other_social_links),
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
      stats: {
        app_likes: video.app_like_count,
        score: video.score,
      },
      members: video.members.map((member) => ({
        name: member.name,
        x_id: member.x_user_id,
        x_url: xProfileUrl(member.x_user_id) || null,
        role_label: member.role_label,
        order: member.order_index,
        chapters: parseAnswerJson(member.chapters_json),
      })),
      softwares: video.softwares.map((software) => ({
        name: software.name,
        source_label: software.raw_label,
        order: software.order_index,
      })),
      custom_answers: video.answers.map((answer) => ({
        key: answer.key,
        label: answer.label,
        value: answer.answer_json ? parseAnswerJson(answer.answer_json) : answer.answer_text,
        order: answer.sort_order,
      })),
    })),
    meta: {
      count: snapshot.videos.length,
      limit: snapshot.limit,
      truncated: snapshot.truncated,
    },
  };
}

export function buildEventExportPayload(
  snapshot: EventExportSnapshot,
  format: EventExportFormat,
  generatedAt = Math.floor(Date.now() / 1000),
  updateMode: EventExportUpdateMode = "realtime",
): unknown {
  return format === "legacy"
    ? buildLegacyRows(snapshot)
    : buildNewPayload(snapshot, generatedAt, updateMode);
}
