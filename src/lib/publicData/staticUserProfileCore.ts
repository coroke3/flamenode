import type { VideoCardData } from "@/components/video/VideoCard";
import { isPublicVideoListable } from "./visibility.ts";

export interface StaticUserProfilePayload {
  generated_at?: unknown;
  user?: Record<string, unknown>;
  recent_videos?: unknown;
  total_works?: unknown;
}

export interface StaticUserProfile {
  generatedAt: number | null;
  user: {
    id: string;
    x_name: string;
    icon_url: string | null;
    profile_text: string | null;
    portfolio_contact: string | null;
    youtube_channel_url: string | null;
    other_social_links: string | null;
  };
  recentVideos: VideoCardData[];
  totalWorks: number;
}

export function normalizeStaticUserProfile(
  payload: StaticUserProfilePayload,
): StaticUserProfile | null {
  if (!payload.user || typeof payload.user !== "object") return null;
  const userRow = payload.user as Record<string, unknown>;
  const id = normalizeString(userRow.id);
  const xName = normalizeString(userRow.x_name) ?? id;
  if (!id || !xName) return null;
  const recentVideos = Array.isArray(payload.recent_videos)
    ? payload.recent_videos
        .map(normalizeVideo)
        .filter((video): video is VideoCardData => video !== null)
    : [];
  return {
    generatedAt: normalizeUnix(payload.generated_at),
    user: {
      id,
      x_name: xName,
      icon_url: normalizeNullableString(userRow.icon_url),
      profile_text: normalizeNullableString(userRow.profile_text),
      portfolio_contact: normalizeNullableString(userRow.portfolio_contact),
      youtube_channel_url: normalizeNullableString(userRow.youtube_channel_url),
      other_social_links: normalizeNullableString(userRow.other_social_links),
    },
    recentVideos,
    totalWorks: normalizeCount(payload.total_works) ?? recentVideos.length,
  };
}

function normalizeVideo(value: unknown): VideoCardData | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title || !isPublicVideoListable(row.status ?? row.visibility_status)) {
    return null;
  }
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    display_name:
      normalizeString(row.display_name) ??
      normalizeString(row.creator_display_name) ??
      "unknown",
    icon_url:
      normalizeNullableString(row.icon_url) ??
      normalizeNullableString(row.creator_icon_url),
    creator_x_user_id: normalizeNullableString(row.creator_x_user_id),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    scheduled_time: normalizeUnix(row.scheduled_time),
    status: "public",
    part: normalizeNullableString(row.part),
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeUnix(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function normalizeCount(value: unknown): number | null {
  const n = normalizeUnix(value);
  return n != null && n >= 0 ? n : null;
}
