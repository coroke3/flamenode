import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import type { StaticRecentVideo, StaticRecentVideoPage } from "./staticRecentVideoCore";
import {
  buildStaticSearchPostingArtifacts,
  normalizeStaticSearchPostingDirectory,
  normalizeStaticSearchPostingManifest,
  normalizeStaticSearchPostingPage,
  staticSearchPostingDirectoryObjectKey,
  staticSearchPostingPageObjectKey,
  type StaticSearchPostingArtifacts,
  type StaticSearchPostingDirectory,
  type StaticSearchPostingManifest,
  type StaticSearchPostingPage,
} from "./staticSearchPostingsCore.ts";

export interface StaticSearchIndexPayload {
  generated_at?: unknown;
  videos?: unknown;
  users?: unknown;
}

export interface StaticSearchIndexVideo {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  creator_x_user_id: string | null;
  creator_x_user_name?: string | null;
}

export function normalizeSearchVideo(value: unknown): StaticSearchIndexVideo | null {
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
    creator_x_user_name: normalizeNullableString(row.creator_x_user_name),
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
  if (
    video.title.toLowerCase().includes(query) ||
    video.display_name.toLowerCase().includes(query) ||
    (video.creator_x_user_id ?? "").toLowerCase().includes(query) ||
    (video.youtube_video_id ?? "").toLowerCase().includes(query) ||
    video.id.toLowerCase().includes(query)
  ) {
    return true;
  }
  const creatorId = video.creator_x_user_id?.toLowerCase();
  if (creatorId) {
    const userName = userNames.get(creatorId);
    if (userName?.toLowerCase().includes(query)) return true;
  }
  return video.creator_x_user_name?.toLowerCase().includes(query) ?? false;
}

export function staticSearchVideoMatchesQuery(
  video: StaticSearchIndexVideo,
  query: string,
  userNames = new Map<string, string>(),
): boolean {
  return matchesQuery(video, userNames, query.trim().toLowerCase());
}

export function toListVideo(video: StaticSearchIndexVideo): StaticRecentVideo {
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
  const videos: StaticSearchIndexVideo[] = [];
  for (const row of params.payload.videos) {
    const video = normalizeSearchVideo(row);
    if (video && matchesQuery(video, userNames, query)) videos.push(video);
  }
  if (params.sort === "old") videos.reverse();

  const pageNum = Math.max(1, Math.floor(params.page));
  const size = Math.max(1, Math.floor(params.pageSize));
  const offset = (pageNum - 1) * size;

  return {
    videos: videos.slice(offset, offset + size).map(toListVideo),
    total: videos.length,
    generatedAt: normalizeUnix(params.payload.generated_at),
  };
}

export function normalizeStaticSearchIndexPayload(
  payload: StaticSearchIndexPayload,
): StaticSearchIndexPayload | null {
  if (!Array.isArray(payload.videos)) return null;
  return payload;
}

/** Generation stored in video posting objects for a content hash. */
export function staticVideoSearchPostingGeneration(generation: string): string {
  return `videos-${generation}`;
}

export function buildStaticVideoSearchPostingArtifacts(args: {
  items: readonly StaticSearchIndexVideo[];
  generatedAt: number;
  generation: string;
}): StaticSearchPostingArtifacts<StaticSearchIndexVideo> {
  return buildStaticSearchPostingArtifacts({
    ...args,
    generation: staticVideoSearchPostingGeneration(args.generation),
    textOf: (video) => [
      video.id,
      video.title,
      video.display_name,
      video.creator_x_user_id ?? "",
      video.creator_x_user_name ?? "",
      video.youtube_video_id ?? "",
    ],
    keyOf: (video) => video.id,
  });
}

export function normalizeStaticVideoSearchPostingManifest(
  value: unknown,
): StaticSearchPostingManifest | null {
  return normalizeStaticSearchPostingManifest(value);
}

export function normalizeStaticVideoSearchPostingDirectory(
  value: unknown,
): StaticSearchPostingDirectory | null {
  return normalizeStaticSearchPostingDirectory(value);
}

export function normalizeStaticVideoSearchPostingPage(
  value: unknown,
): StaticSearchPostingPage<StaticSearchIndexVideo> | null {
  return normalizeStaticSearchPostingPage(value, normalizeSearchVideo);
}

export function staticVideoSearchPostingManifestObjectKey(generation: string): string {
  void generation;
  return "search-index-postings.v1/manifest.json";
}

export function staticVideoSearchPostingDirectoryObjectKey(
  generation: string,
  bucket: number,
): string {
  return staticSearchPostingDirectoryObjectKey(
    staticVideoSearchPostingGeneration(generation),
    bucket,
  );
}

export function staticVideoSearchPostingPageObjectKey(
  generation: string,
  bucket: number,
  page: number,
): string {
  return staticSearchPostingPageObjectKey(
    staticVideoSearchPostingGeneration(generation),
    bucket,
    page,
  );
}

/** Directory and page keys of a generation, listed from manifest page counts. */
export function staticVideoSearchPostingObjectKeys(
  generation: string,
  pageCounts: readonly number[],
): string[] {
  const keys: string[] = [];
  pageCounts.forEach((count, bucket) => {
    if (count === 0) return;
    keys.push(staticVideoSearchPostingDirectoryObjectKey(generation, bucket));
    for (let page = 1; page <= count; page += 1) {
      keys.push(staticVideoSearchPostingPageObjectKey(generation, bucket, page));
    }
  });
  return keys;
}
