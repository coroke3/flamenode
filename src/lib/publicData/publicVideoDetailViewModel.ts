import type { VideoCardData } from "@/components/video/VideoCard";
import type {
  StaticMemberChapter,
  StaticPublicChapter,
  StaticPublicEvent,
  StaticRelatedVideo,
  StaticVideoDetail,
  StaticVideoMember,
} from "./staticVideoDetailCore";
import { resolveVisibleRelatedVideos } from "./relatedVideoProjection";
import type { PublicXIconEntry } from "./publicIconProjection";

/** 公開動画ページが SSR する関連件数。Workers Free の HTTP 10ms に収める。 */
export const PUBLIC_RELATED_SSR_LIMIT = 12;

export interface PublicVideoDetailViewModel {
  generatedAt: number | null;
  video: StaticVideoDetail["video"] & {
    app_like_count: number;
  };
  softwareLabels: string[];
  softwareLabel: string | null;
  appLikeCount: number;
  eventIds: string[];
  publicEvents: StaticPublicEvent[];
  primaryEvent: StaticPublicEvent | null;
  publicMembers: StaticVideoMember[];
  publicChapters: StaticPublicChapter[];
  memberChapters: StaticMemberChapter[];
  relatedVideos: VideoCardData[];
}

/**
 * Remove event references that are still present in a stale video artifact
 * while the event visibility fence is blocking public delivery.
 *
 * Video artifacts are rebuilt independently from event artifacts. Keeping
 * this projection pure lets the request layer apply the R2 fence without
 * changing the static payload format or issuing per-event D1 reads.
 */
export function filterPublicVideoDetailEvents(
  detail: StaticVideoDetail,
  blockedEventIds: ReadonlySet<string>,
): StaticVideoDetail {
  if (blockedEventIds.size === 0) return detail;
  const publicEvents = detail.publicEvents.filter(
    (event) => !blockedEventIds.has(event.id),
  );
  const eventIds = detail.eventIds.filter((eventId) => !blockedEventIds.has(eventId));
  if (
    publicEvents.length === detail.publicEvents.length &&
    eventIds.length === detail.eventIds.length
  ) {
    return detail;
  }
  return { ...detail, publicEvents, eventIds };
}

export function buildPublicVideoViewModelFromStatic(
  detail: StaticVideoDetail,
  options?: {
    relatedBlockedIds?: ReadonlySet<string> | null;
    relatedUnavailable?: boolean;
    relatedFallbackPool?: readonly StaticRelatedVideo[];
    iconMap?: ReadonlyMap<string, PublicXIconEntry> | null;
  },
): PublicVideoDetailViewModel {
  const primaryEvent =
    detail.publicEvents.find((event) => event.id === detail.video.primary_event_id) ??
    detail.publicEvents[0] ??
    null;

  const projectedVideo = {
    ...detail.video,
  };

  const relatedVideos = options?.relatedUnavailable
    ? []
    : resolveVisibleRelatedVideos({
        primary: detail.relatedVideos,
        reserve: detail.relatedReserve,
        randomIds: detail.relatedRandomIds,
        randomReserve: detail.relatedRandomReserve,
        fallbackPool: options?.relatedFallbackPool,
        blockedIds: options?.relatedBlockedIds,
        currentVideoId: detail.video.id,
        seed: detail.relatedRandomSeed || detail.video.id,
        minTarget: PUBLIC_RELATED_SSR_LIMIT,
        maxTarget: PUBLIC_RELATED_SSR_LIMIT,
      }).map((video) => toVideoCardData(video));

  return {
    generatedAt: detail.generatedAt,
    video: {
      ...projectedVideo,
      app_like_count: detail.appLikeCount,
    },
    softwareLabels: detail.softwareLabels,
    softwareLabel:
      detail.softwareLabels.length > 0 ? detail.softwareLabels.join(", ") : null,
    appLikeCount: detail.appLikeCount,
    eventIds: detail.eventIds,
    publicEvents: detail.publicEvents,
    primaryEvent,
    publicMembers: detail.publicMembers,
    publicChapters: detail.publicChapters,
    memberChapters: detail.memberChapters,
    relatedVideos,
  };
}

export function buildPublicVideoViewModelFromDatabase(args: {
  video: {
    id: string;
    title: string;
    youtube_video_id: string | null;
    creator_display_name: string | null;
    creator_icon_url: string | null;
    creator_x_user_id: string | null;
    creator_youtube_channel_url?: string | null;
    creator_profile_text?: string | null;
    creator_other_social_links?: string | null;
    music: string | null;
    credit: string | null;
    music_reference_url?: string | null;
    intro_comment: string | null;
    highlights: string | null;
    production_story: string | null;
    closing_comment: string | null;
    visibility_status: string;
    scheduled_time: number | null;
    primary_event_id: string | null;
    collaboration_type: string | null;
    part: string | null;
    app_like_count?: number | null;
  };
  events: Array<{
    id: string;
    title: string;
    icon_url: string | null;
    accent_color: string | null;
    start_time: number | null;
    end_time: number | null;
    entry_start_time: number | null;
    entry_end_time: number | null;
    visibility_status: string | null;
  }>;
  members: Array<{
    id: string;
    x_user_id: string | null;
    name: string | null;
    role: string | null;
    comment: string | null;
    order_index: number | null;
    x_name: string | null;
    icon_url: string | null;
  }>;
  chapters: Array<{
    id: string;
    chapter_time: number;
    chapter_label: string;
    note: string | null;
    author_name: string | null;
    author_icon: string | null;
    visibility?: string | null;
  }>;
  memberChapters: Array<{
    id: string;
    video_member_id: string;
    chapter_time: number;
    chapter_label: string;
    note: string | null;
    order_index: number;
  }>;
  related: VideoCardData[];
  softwareLabel: string | null;
  softwareLabels?: string[];
}): PublicVideoDetailViewModel {
  const softwareLabels =
    args.softwareLabels ??
    (args.softwareLabel
      ? args.softwareLabel.split(",").map((label) => label.trim()).filter(Boolean)
      : []);
  const publicEvents = args.events
    .filter((event) => event.visibility_status === "public")
    .map((event) => ({
      id: event.id,
      title: event.title,
      icon_url: event.icon_url,
      accent_color: event.accent_color,
      start_time: event.start_time,
      end_time: event.end_time,
      entry_start_time: event.entry_start_time,
      entry_end_time: event.entry_end_time,
      visibility_status: "public" as const,
    }));
  const primaryEvent =
    publicEvents.find((event) => event.id === args.video.primary_event_id) ??
    publicEvents[0] ??
    null;
  const creatorXUserId = args.video.creator_x_user_id?.trim() || undefined;

  return {
    generatedAt: null,
    video: {
      id: args.video.id,
      title: args.video.title,
      ...(creatorXUserId ? { creator_x_user_id: creatorXUserId } : {}),
      youtube_video_id: args.video.youtube_video_id,
      creator_display_name: args.video.creator_display_name,
      creator_icon_url: args.video.creator_icon_url,
      creator_youtube_channel_url: args.video.creator_youtube_channel_url ?? null,
      creator_profile_text: args.video.creator_profile_text ?? null,
      creator_other_social_links: args.video.creator_other_social_links ?? null,
      music: args.video.music,
      credit: args.video.credit,
      music_reference_url: args.video.music_reference_url ?? null,
      intro_comment: args.video.intro_comment,
      highlights: args.video.highlights,
      production_story: args.video.production_story,
      closing_comment: args.video.closing_comment,
      visibility_status: args.video.visibility_status,
      scheduled_time: args.video.scheduled_time,
      primary_event_id: args.video.primary_event_id,
      collaboration_type: args.video.collaboration_type,
      part: args.video.part,
      app_like_count: args.video.app_like_count ?? 0,
    },
    softwareLabels,
    softwareLabel: args.softwareLabel,
    appLikeCount: args.video.app_like_count ?? 0,
    eventIds: publicEvents.map((event) => event.id),
    publicEvents,
    primaryEvent,
    publicMembers: args.members.map((member) => ({
      id: member.id,
      display_name:
        member.name?.trim() || member.x_name?.trim() || member.x_user_id || "anonymous",
      x_user_id: member.x_user_id,
      role_label: member.role,
      order_index: member.order_index,
    })),
    publicChapters: args.chapters
      .filter((chapter) => (chapter.visibility ?? "public") === "public")
      .map((chapter) => ({
        id: chapter.id,
        chapter_time: chapter.chapter_time,
        chapter_label: chapter.chapter_label,
        note: chapter.note,
        author_name: chapter.author_name,
        author_icon: chapter.author_icon,
      })),
    memberChapters: args.memberChapters.map((chapter) => ({
      id: chapter.id,
      video_member_id: chapter.video_member_id,
      chapter_time: chapter.chapter_time,
      chapter_label: chapter.chapter_label,
      note: chapter.note,
      order_index: chapter.order_index,
    })),
    relatedVideos: args.related,
  };
}

function toVideoCardData(video: StaticRelatedVideo): VideoCardData {
  return {
    id: video.id,
    title: video.title,
    youtube_video_id: video.youtube_video_id,
    display_name: video.display_name,
    icon_url: video.icon_url,
    creator_x_user_id: video.creator_x_user_id,
    primary_event_id: video.primary_event_id,
    scheduled_time: video.scheduled_time,
  };
}
