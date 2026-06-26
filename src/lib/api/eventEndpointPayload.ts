import { isAcceptingEntries } from "#utils/event-status-core";

export const EVENT_API_VIDEO_LIMIT = 50;
export const EVENT_API_EXPLANATION_MAX = 280;

export interface EventApiEventInput {
  id: string;
  title: string;
  explanation: string | null;
  is_active: number | null;
  /** Legacy storage flag. Public payload now derives this from entry dates. */
  is_entry_open: number | null;
  is_archived: number | null;
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
    is_active: boolean;
    is_entry_open: boolean;
    is_archived: boolean;
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
  now: number = Math.floor(Date.now() / 1000),
): EventApiPayload {
  const safeLimit = Math.max(1, Math.min(EVENT_API_VIDEO_LIMIT, Math.floor(limit)));
  return {
    event: {
      id: event.id,
      title: event.title,
      explanation: truncateForEventApi(event.explanation),
      is_active: event.is_active === 1,
      is_entry_open: isAcceptingEntries(event, now),
      is_archived: event.is_archived === 1,
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
