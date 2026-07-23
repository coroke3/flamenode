import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import type { StaticRecentVideo, StaticRecentVideoPage } from "./staticRecentVideoCore";

export interface StaticPopularVideosPayload {
  generated_at?: unknown;
  total?: unknown;
  items?: unknown;
}

export function normalizeStaticPopularVideoPage(
  payload: StaticPopularVideosPayload,
  page: number,
  pageSize: number,
): StaticRecentVideoPage | null {
  if (!Array.isArray(payload.items)) return null;
  const normalized = payload.items
    .map(normalizeStaticPopularVideoRow)
    .filter((row): row is StaticRecentVideo => row !== null);
  const total = normalizeCount(payload.total) ?? normalized.length;
  const pageNum = Math.max(1, Math.floor(page));
  const size = Math.max(1, Math.floor(pageSize));
  const offset = (pageNum - 1) * size;
  if (offset >= normalized.length && total > normalized.length) {
    return null;
  }
  return {
    videos: normalized.slice(offset, offset + size),
    total,
    generatedAt: normalizeUnix(payload.generated_at),
  };
}

function normalizeStaticPopularVideoRow(value: unknown): StaticRecentVideo | null {
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
      normalizeString(row.display_name) ??
      normalizeString(row.creator_display_name) ??
      "unknown",
    icon_url:
      normalizeNullableString(row.icon_url) ??
      normalizeNullableString(row.creator_icon_url),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    primary_event_title: normalizeNullableString(row.primary_event_title),
    scheduled_time: normalizeUnix(row.scheduled_time),
    status: "public",
    part: null,
  };
}
