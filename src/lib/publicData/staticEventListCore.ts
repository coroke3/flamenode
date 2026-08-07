import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import type { StaticEventDetailPayload } from "./staticEventDetailCore";
import type { StaticRecentVideoPage } from "./staticRecentVideoCore";

/** event_base の public_videos pool 上限（rebuildEventBase と一致）。 */
export const EVENT_LIST_POOL_MAX = 500;

interface EventBaseListVideo {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  creator_x_user_id: string | null;
  scheduled_time: number | null;
  score: number;
  part: string | null;
}

/** video_total と pool 件数が一致し、上限以内なら R2 pool を完全とみなす。 */
export function isCompleteEventBasePool(
  payload: StaticEventDetailPayload,
): boolean {
  if (!payload || typeof payload !== "object") return false;
  const videos = payload.public_videos;
  if (!Array.isArray(videos)) return false;
  if (videos.length > EVENT_LIST_POOL_MAX) return false;
  const videoTotal = normalizeCount(payload.video_total) ?? videos.length;
  if (videoTotal > EVENT_LIST_POOL_MAX) return false;
  return videoTotal === videos.length;
}

export function extractEventListInfo(
  payload: StaticEventDetailPayload,
): { id: string; title: string } | null {
  if (!payload.event || typeof payload.event !== "object") return null;
  const row = payload.event as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  const visibility = normalizeString(row.visibility_status);
  if (!id || !title || visibility !== "public") return null;
  return { id, title };
}

function normalizeEventBaseListVideo(value: unknown): EventBaseListVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;
  const scoreRaw = row.score ?? row.video_score;
  const score =
    typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : 0;
  const partRaw = row.part;
  const part =
    partRaw == null || String(partRaw).trim() === ""
      ? null
      : String(partRaw).trim();
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    display_name:
      normalizeString(row.creator_display_name) ??
      normalizeString(row.display_name) ??
      normalizeString(row.creator_x_user_id) ??
      "unknown",
    icon_url:
      normalizeNullableString(row.creator_icon_url) ??
      normalizeNullableString(row.icon_url),
    creator_x_user_id: normalizeNullableString(row.creator_x_user_id),
    scheduled_time: normalizeUnix(row.scheduled_time),
    score,
    part,
  };
}

function matchesEventListQuery(video: EventBaseListVideo, query: string): boolean {
  const haystacks = [
    video.title,
    video.display_name,
    video.creator_x_user_id ?? "",
    video.id,
  ];
  return haystacks.some((value) => value.toLowerCase().includes(query));
}

function sortEventBaseVideos(
  videos: EventBaseListVideo[],
  sort: "new" | "old" | "score",
): EventBaseListVideo[] {
  const copy = [...videos];
  if (sort === "old") {
    return copy.sort(
      (left, right) =>
        (left.scheduled_time ?? 0) - (right.scheduled_time ?? 0) ||
        left.id.localeCompare(right.id),
    );
  }
  if (sort === "score") {
    return copy.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (
        (right.scheduled_time ?? 0) - (left.scheduled_time ?? 0) ||
        left.id.localeCompare(right.id)
      );
    });
  }
  return copy.sort((left, right) => {
    const timeDiff =
      (right.scheduled_time ?? 0) - (left.scheduled_time ?? 0);
    if (timeDiff !== 0) return timeDiff;
    return left.id.localeCompare(right.id);
  });
}

export function pageEventBaseVideos(params: {
  payload: StaticEventDetailPayload;
  sort: "new" | "old" | "score";
  page: number;
  pageSize: number;
  q?: string;
  eventTitle?: string | null;
}): StaticRecentVideoPage | null {
  if (!isCompleteEventBasePool(params.payload)) return null;
  const eventInfo = extractEventListInfo(params.payload);
  if (!eventInfo) return null;
  const eventTitle = params.eventTitle ?? eventInfo.title;

  const videos = (params.payload.public_videos as unknown[])
    .map(normalizeEventBaseListVideo)
    .filter((row): row is EventBaseListVideo => row !== null);

  const query = params.q?.trim().toLowerCase() ?? "";
  const filtered = query
    ? videos.filter((video) => matchesEventListQuery(video, query))
    : videos;
  const ordered = sortEventBaseVideos(filtered, params.sort);

  const pageNum = Math.max(1, Math.floor(params.page));
  const size = Math.max(1, Math.floor(params.pageSize));
  const offset = (pageNum - 1) * size;

  return {
    videos: ordered.slice(offset, offset + size).map((video) => ({
      id: video.id,
      title: video.title,
      youtube_video_id: video.youtube_video_id,
      display_name: video.display_name,
      icon_url: video.icon_url,
      primary_event_id: eventInfo.id,
      primary_event_title: eventTitle,
      scheduled_time: video.scheduled_time,
      status: "public",
      part: video.part,
    })),
    total: ordered.length,
    generatedAt: normalizeUnix(params.payload.generated_at),
  };
}
