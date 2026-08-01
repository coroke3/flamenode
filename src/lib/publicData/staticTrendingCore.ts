import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";

export const TRENDING_OBJECT_KEY = "analytics/trending.json";
export const TRENDING_STALE_MAX_AGE_SEC = 3 * 60 * 60;
export const TRENDING_TOO_OLD_FOR_HOME_SEC = 24 * 60 * 60;

/** workers/ga-analytics/ranking.ts の TrendingItem と整合 */
export interface TrendingItem {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  primary_event_id: string | null;
  primary_event_title: string | null;
  scheduled_time: number | null;
  status: "public";
  views_2d: number;
  views_5d: number;
  views_7d: number;
  views_30d: number;
  rank?: number;
  video_id?: string;
}

export const STATIC_TRENDING_SCHEMA_VERSION = 1;

export interface StaticTrendingPayload {
  generated_at?: unknown;
  schema_version?: unknown;
  items?: unknown;
}

export interface StaticTrendingData {
  generatedAt: number;
  items: TrendingItem[];
}

export interface StaticTrendingStaleMeta {
  stale: boolean;
  ageSeconds: number | null;
  tooOldForHome: boolean;
}

function normalizeViews(value: unknown): number | null {
  const count = normalizeCount(value);
  return count != null ? count : null;
}

function normalizeRank(value: unknown): number | null {
  const count = normalizeCount(value);
  if (count == null || count < 1) return null;
  return count;
}

function normalizeTrendingItem(value: unknown): TrendingItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;

  const views2d = normalizeViews(row.views_2d);
  const views5d = normalizeViews(row.views_5d);
  const views7d = normalizeViews(row.views_7d);
  const views30d = normalizeViews(row.views_30d);
  if (
    views2d == null ||
    views5d == null ||
    views7d == null ||
    views30d == null
  ) {
    return null;
  }

  if (row.status != null && row.status !== "public") return null;

  const rank =
    row.rank !== undefined && row.rank !== null
      ? normalizeRank(row.rank)
      : undefined;
  if (row.rank !== undefined && row.rank !== null && rank == null) return null;

  const videoId =
    row.video_id !== undefined && row.video_id !== null
      ? normalizeString(row.video_id)
      : undefined;
  if (
    row.video_id !== undefined &&
    row.video_id !== null &&
    (videoId == null || videoId !== id)
  ) {
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
    primary_event_id: normalizeNullableString(row.primary_event_id),
    primary_event_title: normalizeNullableString(row.primary_event_title),
    scheduled_time: normalizeUnix(row.scheduled_time),
    status: "public",
    views_2d: views2d,
    views_5d: views5d,
    views_7d: views7d,
    views_30d: views30d,
    ...(rank != null ? { rank } : {}),
    ...(videoId != null ? { video_id: videoId } : {}),
  };
}

export function normalizeStaticTrending(
  payload: StaticTrendingPayload,
): StaticTrendingData | null {
  if (payload.schema_version !== STATIC_TRENDING_SCHEMA_VERSION) return null;
  const generatedAt = normalizeUnix(payload.generated_at);
  if (generatedAt == null) return null;
  if (!Array.isArray(payload.items)) return null;

  const items = payload.items
    .map(normalizeTrendingItem)
    .filter((row): row is TrendingItem => row !== null);

  return { generatedAt, items };
}

export function resolveStaticTrendingStaleMeta(
  generatedAt: number | null,
  nowSec: number,
): StaticTrendingStaleMeta {
  if (generatedAt == null) {
    return { stale: true, ageSeconds: null, tooOldForHome: true };
  }
  const ageSeconds = Math.max(0, nowSec - generatedAt);
  return {
    stale: ageSeconds > TRENDING_STALE_MAX_AGE_SEC,
    ageSeconds,
    tooOldForHome: ageSeconds > TRENDING_TOO_OLD_FOR_HOME_SEC,
  };
}
