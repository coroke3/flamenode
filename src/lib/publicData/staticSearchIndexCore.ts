import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import type { StaticRecentVideo, StaticRecentVideoPage } from "./staticRecentVideoCore";

export interface StaticSearchIndexPayload {
  generated_at?: unknown;
  videos?: unknown;
  users?: unknown;
}

interface StaticSearchIndexVideo {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  creator_x_user_id: string | null;
}

function normalizeSearchVideo(value: unknown): StaticSearchIndexVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    display_name:
      normalizeString(row.creator_display_name) ??
      normalizeString(row.display_name) ??
      "unknown",
    creator_x_user_id: normalizeNullableString(row.creator_x_user_id),
  };
}

function normalizeUserNameMap(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = normalizeString(row.id);
    const name = normalizeString(row.x_name);
    if (id && name) result.set(id.toLowerCase(), name);
  }
  return result;
}

function matchesQuery(
  video: StaticSearchIndexVideo,
  userNames: Map<string, string>,
  query: string,
): boolean {
  const haystacks = [
    video.title,
    video.display_name,
    video.creator_x_user_id ?? "",
    video.youtube_video_id ?? "",
    video.id,
  ];
  const creatorId = video.creator_x_user_id?.toLowerCase();
  if (creatorId && userNames.has(creatorId)) {
    haystacks.push(userNames.get(creatorId)!);
  }
  return haystacks.some((value) => value.toLowerCase().includes(query));
}

function toListVideo(video: StaticSearchIndexVideo): StaticRecentVideo {
  return {
    id: video.id,
    title: video.title,
    youtube_video_id: video.youtube_video_id,
    display_name: video.display_name,
    icon_url: null,
    primary_event_id: null,
    primary_event_title: null,
    scheduled_time: null,
    status: "public",
    part: null,
  };
}

export function searchStaticIndexVideos(params: {
  payload: StaticSearchIndexPayload;
  q: string;
  sort: "new" | "old" | "score";
  page: number;
  pageSize: number;
}): StaticRecentVideoPage | null {
  if (!Array.isArray(params.payload.videos)) return null;
  const query = params.q.trim().toLowerCase();
  if (!query) return null;

  const userNames = normalizeUserNameMap(params.payload.users);
  const videos = params.payload.videos
    .map(normalizeSearchVideo)
    .filter((row): row is StaticSearchIndexVideo => row !== null)
    .filter((video) => matchesQuery(video, userNames, query));

  const ordered =
    params.sort === "old"
      ? [...videos].reverse()
      : videos;

  const pageNum = Math.max(1, Math.floor(params.page));
  const size = Math.max(1, Math.floor(params.pageSize));
  const offset = (pageNum - 1) * size;

  return {
    videos: ordered.slice(offset, offset + size).map(toListVideo),
    total: ordered.length,
    generatedAt: normalizeUnix(params.payload.generated_at),
  };
}

export function normalizeStaticSearchIndexPayload(
  payload: StaticSearchIndexPayload,
): StaticSearchIndexPayload | null {
  if (!Array.isArray(payload.videos)) return null;
  return payload;
}
