import { videos } from "@flamenode/db/schema";

/**
 * SA-086: construct the exact CURRENT videos row. All URL, social-link and icon
 * validation/normalization must have passed before calling this pure builder.
 * Hono and CURRENT Next share these defaults and the same audit after-snapshot.
 */
export type FreeVideoRowFormFields = {
  is_collab?: boolean | null;
  part?: string | null;
  display_name: string;
  profile_text?: string | null;
  title: string;
  music?: string | null;
  credit?: string | null;
  music_reference_url?: string | null;
  closing_comment?: string | null;
  intro_comment?: string | null;
  highlights?: string | null;
  production_story?: string | null;
};

export function buildFreeVideoRow(args: {
  videoId: string;
  eventId: string | null;
  activeX: string;
  userId: string;
  data: FreeVideoRowFormFields;
  iconUrl: string | null;
  creatorYoutubeChannelUrl: string | null;
  creatorOtherSocialLinks: string | null;
  youtubeId: string;
  scheduledTime: number;
  now: number;
}): typeof videos.$inferSelect {
  const {
    videoId, eventId, activeX, userId, data, iconUrl,
    creatorYoutubeChannelUrl, creatorOtherSocialLinks, youtubeId,
    scheduledTime, now,
  } = args;
    return {
    id: videoId,
    primary_event_id: eventId,
    creator_x_user_id: activeX,
    submitted_by_user_id: userId,
    collaboration_type: data.is_collab ? "collab" : "individual",
    part: data.part?.trim() || null,
    source_type: "youtube",
    creator_display_name: data.display_name,
    creator_display_name_yomi: null,
    creator_icon_url: iconUrl,
    creator_youtube_channel_url: creatorYoutubeChannelUrl,
    creator_profile_text: data.profile_text ?? null,
    creator_other_social_links: creatorOtherSocialLinks,
    title: data.title,
    music: data.music ?? null,
    credit: data.credit ?? null,
    music_reference_url: data.music_reference_url ?? null,
    closing_comment: data.closing_comment ?? null,
    youtube_video_id: youtubeId,
    intro_comment: data.intro_comment ?? null,
    highlights: data.highlights ?? null,
    production_story: data.production_story ?? null,
    visibility_status: "public",
    scheduling_type: "manual",
    scheduled_time: scheduledTime,
    app_like_count: 0,
    score: 0,
    score_updated_at: null,
    created_at: now,
    updated_at: now,
  };
}
