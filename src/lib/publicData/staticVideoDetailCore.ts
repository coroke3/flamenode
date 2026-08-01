import { isPublicVideoDirect } from "./visibility.ts";
import {
  normalizeCoercedString as normalizeNullableString,
  normalizeCount,
  normalizeNullableUnix as normalizeUnix,
  normalizeTrimmedString as normalizeString,
} from "./normalize";

export interface StaticVideoDetailPayload {
  schema_version?: unknown;
  generated_at?: unknown;
  video?: Record<string, unknown>;
  event_ids?: unknown;
  public_members?: unknown;
  software_labels?: unknown;
  app_like_count?: unknown;
  public_chapters?: unknown;
  member_chapters?: unknown;
  public_events?: unknown;
  related_videos?: unknown;
  related_reserve?: unknown;
  related_random_ids?: unknown;
  related_random_reserve?: unknown;
  related_random_seed?: unknown;
}

export interface StaticVideoDetailVideo {
  id: string;
  title: string;
  /** UI compatibility only; public payloads must not populate this internal key. */
  creator_x_user_id?: string;
  youtube_video_id: string | null;
  creator_display_name: string | null;
  creator_icon_url: string | null;
  creator_has_public_profile?: boolean;
  creator_youtube_channel_url?: string | null;
  creator_profile_text?: string | null;
  creator_other_social_links?: string | null;
  music: string | null;
  credit: string | null;
  music_reference_url: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  closing_comment: string | null;
  visibility_status: string;
  scheduled_time: number | null;
  primary_event_id: string | null;
  collaboration_type: string | null;
  part: string | null;
}

export interface StaticVideoMember {
  id: string;
  display_name: string;
  x_user_id: string | null;
  role_label: string | null;
  order_index: number | null;
  comment?: string | null;
  x_name?: string | null;
  icon_url?: string | null;
  has_public_profile?: boolean;
}

export interface StaticPublicChapter {
  id: string;
  chapter_time: number;
  chapter_label: string;
  note: string | null;
  author_name: string | null;
  author_icon: string | null;
}

export interface StaticMemberChapter {
  id: string;
  video_member_id: string;
  chapter_time: number;
  chapter_label: string;
  note: string | null;
  order_index: number | null;
}

export interface StaticPublicEvent {
  id: string;
  title: string;
  icon_url: string | null;
  accent_color: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  visibility_status: "public";
}

export interface StaticRelatedVideo {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  creator_x_user_id: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
}

export interface StaticVideoDetail {
  schemaVersion: 1 | 2;
  generatedAt: number | null;
  video: StaticVideoDetailVideo;
  eventIds: string[];
  publicMembers: StaticVideoMember[];
  softwareLabels: string[];
  appLikeCount: number;
  publicChapters: StaticPublicChapter[];
  memberChapters: StaticMemberChapter[];
  publicEvents: StaticPublicEvent[];
  relatedVideos: StaticRelatedVideo[];
  relatedReserve: StaticRelatedVideo[];
  relatedRandomIds: string[];
  relatedRandomReserve: StaticRelatedVideo[];
  relatedRandomSeed: string;
}

export function normalizeStaticVideoDetail(
  payload: StaticVideoDetailPayload,
): StaticVideoDetail | null {
  if (!payload.video || typeof payload.video !== "object") return null;
  const video = normalizeVideo(payload.video);
  if (!video) return null;

  const eventIds = Array.isArray(payload.event_ids)
    ? payload.event_ids
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  const publicMembers = Array.isArray(payload.public_members)
    ? payload.public_members
        .map(normalizeMember)
        .filter((member): member is StaticVideoMember => member !== null)
    : [];
  const softwareLabels = Array.isArray(payload.software_labels)
    ? payload.software_labels
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  const publicChapters = Array.isArray(payload.public_chapters)
    ? payload.public_chapters
        .map(normalizePublicChapter)
        .filter((chapter): chapter is StaticPublicChapter => chapter !== null)
    : [];
  const memberChapters = Array.isArray(payload.member_chapters)
    ? payload.member_chapters
        .map(normalizeMemberChapter)
        .filter((chapter): chapter is StaticMemberChapter => chapter !== null)
    : [];
  const publicEvents = Array.isArray(payload.public_events)
    ? payload.public_events
        .map(normalizePublicEvent)
        .filter((event): event is StaticPublicEvent => event !== null)
    : [];
  const relatedVideos = Array.isArray(payload.related_videos)
    ? payload.related_videos
        .map(normalizeRelatedVideo)
        .filter((video): video is StaticRelatedVideo => video !== null)
    : [];
  const relatedReserve = Array.isArray(payload.related_reserve)
    ? payload.related_reserve
        .map(normalizeRelatedVideo)
        .filter((video): video is StaticRelatedVideo => video !== null)
    : [];
  const relatedRandomReserve = Array.isArray(payload.related_random_reserve)
    ? payload.related_random_reserve
        .map(normalizeRelatedVideo)
        .filter((video): video is StaticRelatedVideo => video !== null)
    : [];
  const relatedRandomIds = Array.isArray(payload.related_random_ids)
    ? payload.related_random_ids
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  const relatedRandomSeed =
    typeof payload.related_random_seed === "string"
      ? payload.related_random_seed.trim()
      : "";
  const schemaVersion = Number(payload.schema_version) === 2 ? 2 : 1;

  return {
    schemaVersion,
    generatedAt: normalizeUnix(payload.generated_at),
    video,
    eventIds,
    publicMembers,
    softwareLabels,
    appLikeCount: normalizeCount(payload.app_like_count) ?? 0,
    publicChapters,
    memberChapters,
    publicEvents,
    relatedVideos,
    relatedReserve,
    relatedRandomIds,
    relatedRandomReserve,
    relatedRandomSeed,
  };
}

function normalizeVideo(value: unknown): StaticVideoDetailVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  const visibility = normalizeString(row.visibility_status) ?? "public";
  if (!id || !title || !isPublicVideoDirect(visibility)) return null;
  const creatorXUserId = normalizeNullableString(row.creator_x_user_id);
  return {
    id,
    title,
    ...(creatorXUserId ? { creator_x_user_id: creatorXUserId } : {}),
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    creator_display_name: normalizeNullableString(row.creator_display_name),
    creator_icon_url: normalizeNullableString(row.creator_icon_url),
    creator_has_public_profile:
      row.creator_has_public_profile === 1 ||
      row.creator_has_public_profile === true,
    creator_youtube_channel_url: normalizeNullableString(
      row.creator_youtube_channel_url,
    ),
    creator_profile_text: normalizeNullableString(row.creator_profile_text),
    creator_other_social_links: normalizeNullableString(
      row.creator_other_social_links,
    ),
    music: normalizeNullableString(row.music),
    credit: normalizeNullableString(row.credit),
    music_reference_url: normalizeNullableString(row.music_reference_url),
    intro_comment: normalizeNullableString(row.intro_comment),
    highlights: normalizeNullableString(row.highlights),
    production_story: normalizeNullableString(row.production_story),
    closing_comment: normalizeNullableString(row.closing_comment),
    visibility_status: visibility,
    scheduled_time: normalizeUnix(row.scheduled_time),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    collaboration_type: normalizeNullableString(row.collaboration_type),
    part: normalizeNullableString(row.part),
  };
}

function normalizeMember(value: unknown): StaticVideoMember | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const displayName = normalizeString(row.display_name);
  if (!displayName) return null;
  const id = normalizeString(row.id) ?? displayName;
  return {
    id,
    display_name: displayName,
    x_user_id: normalizeNullableString(row.x_user_id),
    role_label: normalizeNullableString(row.role_label),
    order_index: normalizeUnix(row.order_index),
    comment: normalizeNullableString(row.comment),
    x_name: normalizeNullableString(row.x_name),
    icon_url: normalizeNullableString(row.icon_url),
    has_public_profile:
      row.has_public_profile === 1 || row.has_public_profile === true,
  };
}

function normalizePublicChapter(value: unknown): StaticPublicChapter | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const chapterLabel = normalizeString(row.chapter_label);
  const chapterTime = normalizeUnix(row.chapter_time);
  if (!id || !chapterLabel || chapterTime == null) return null;
  return {
    id,
    chapter_time: chapterTime,
    chapter_label: chapterLabel,
    note: normalizeNullableString(row.note),
    author_name: normalizeNullableString(row.author_name),
    author_icon: normalizeNullableString(row.author_icon),
  };
}

function normalizeMemberChapter(value: unknown): StaticMemberChapter | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const videoMemberId = normalizeString(row.video_member_id);
  const chapterLabel = normalizeString(row.chapter_label);
  const chapterTime = normalizeUnix(row.chapter_time);
  if (!id || !videoMemberId || !chapterLabel || chapterTime == null) return null;
  return {
    id,
    video_member_id: videoMemberId,
    chapter_time: chapterTime,
    chapter_label: chapterLabel,
    note: normalizeNullableString(row.note),
    order_index: normalizeUnix(row.order_index),
  };
}

function normalizePublicEvent(value: unknown): StaticPublicEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  const visibility = normalizeString(row.visibility_status) ?? "public";
  if (!id || !title || visibility !== "public") return null;
  return {
    id,
    title,
    icon_url: normalizeNullableString(row.icon_url),
    accent_color: normalizeNullableString(row.accent_color),
    start_time: normalizeUnix(row.start_time),
    end_time: normalizeUnix(row.end_time),
    entry_start_time: normalizeUnix(row.entry_start_time),
    entry_end_time: normalizeUnix(row.entry_end_time),
    visibility_status: "public",
  };
}

function normalizeRelatedVideo(value: unknown): StaticRelatedVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  const displayName = normalizeString(row.display_name);
  if (!id || !title || !displayName) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    display_name: displayName,
    icon_url: normalizeNullableString(row.icon_url),
    creator_x_user_id: normalizeNullableString(row.creator_x_user_id),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    scheduled_time: normalizeUnix(row.scheduled_time),
  };
}
