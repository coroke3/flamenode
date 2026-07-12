import { getEventVisibility } from "#utils/event-status-core";

export const EVENT_API_VIDEO_LIMIT = 50;
export const EVENT_API_EXPLANATION_MAX = 280;

export interface EventApiEventInput {
  id: string;
  title: string;
  explanation: string | null;
  visibility_status?: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
}

export interface EventApiVideoInput {
  id: string;
  title: string;
  scheduled_time: number | null;
  creator_display_name: string | null;
  youtube_video_id: string | null;
}

export interface EventApiPayload {
  event: {
    id: string;
    title: string;
    explanation: string | null;
    visibility_status: "draft" | "private" | "public" | "archived";
    start_time: number | null;
    end_time: number | null;
    entry_start_time: number | null;
    entry_end_time: number | null;
  };
  videos: Array<{
    id: string;
    title: string;
    scheduled_time: number | null;
    creator_display_name: string | null;
    youtube_video_id: string | null;
  }>;
  limit: number;
}

export function truncateForEventApi(
  value: string | null | undefined,
  max = EVENT_API_EXPLANATION_MAX,
): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

export function buildEventApiPayload(
  event: EventApiEventInput,
  videos: readonly EventApiVideoInput[],
  limit = EVENT_API_VIDEO_LIMIT,
): EventApiPayload {
  const safeLimit = Math.max(1, Math.min(EVENT_API_VIDEO_LIMIT, Math.floor(limit)));
  const visibility = getEventVisibility(event);
  return {
    event: {
      id: event.id,
      title: event.title,
      explanation: truncateForEventApi(event.explanation),
      visibility_status: visibility,
      start_time: event.start_time,
      end_time: event.end_time,
      entry_start_time: event.entry_start_time,
      entry_end_time: event.entry_end_time,
    },
    videos: videos.slice(0, safeLimit).map((video) => ({
      id: video.id,
      title: video.title,
      scheduled_time: video.scheduled_time,
      creator_display_name: video.creator_display_name,
      youtube_video_id: video.youtube_video_id,
    })),
    limit: safeLimit,
  };
}
