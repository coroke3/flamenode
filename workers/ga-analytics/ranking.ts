/**
 * list/recent.json と GA4 集計を照合し TrendingItem を決定的にランキング。
 * D1 は参照しない。
 */
import type { VideoViewPeriods } from "./dataApi.ts";

export interface RecentListPayload {
  items?: unknown;
}

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
  rank: number;
  video_id: string;
}

export const TRENDING_MAX_ITEMS = 200;

type RecentRow = {
  id?: unknown;
  title?: unknown;
  youtube_video_id?: unknown;
  display_name?: unknown;
  creator_display_name?: unknown;
  icon_url?: unknown;
  creator_icon_url?: unknown;
  primary_event_id?: unknown;
  primary_event_title?: unknown;
  scheduled_time?: unknown;
  status?: unknown;
};

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeUnix(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRecentItem(value: unknown): TrendingItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as RecentRow;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeString(row.youtube_video_id),
    display_name:
      normalizeString(row.display_name) ??
      normalizeString(row.creator_display_name) ??
      "unknown",
    icon_url:
      normalizeString(row.icon_url) ??
      normalizeString(row.creator_icon_url),
    primary_event_id: normalizeString(row.primary_event_id),
    primary_event_title: normalizeString(row.primary_event_title),
    scheduled_time: normalizeUnix(row.scheduled_time),
    status: "public",
    views_2d: 0,
    views_5d: 0,
    views_7d: 0,
    views_30d: 0,
  };
}

function buildRecentItemMap(recent: RecentListPayload): Map<string, TrendingItem> {
  const map = new Map<string, TrendingItem>();
  if (!Array.isArray(recent.items)) return map;
  for (const item of recent.items) {
    const normalized = normalizeRecentItem(item);
    if (normalized) map.set(normalized.id, normalized);
  }
  return map;
}

function compareTrendingItems(a: TrendingItem, b: TrendingItem): number {
  if (a.views_2d !== b.views_2d) return b.views_2d - a.views_2d;
  if (a.views_5d !== b.views_5d) return b.views_5d - a.views_5d;
  if (a.views_7d !== b.views_7d) return b.views_7d - a.views_7d;
  if (a.views_30d !== b.views_30d) return b.views_30d - a.views_30d;
  return a.id.localeCompare(b.id);
}

export function rankTrendingItems(
  recent: RecentListPayload,
  periods: readonly VideoViewPeriods[],
): TrendingItem[] {
  const recentById = buildRecentItemMap(recent);
  const ranked: TrendingItem[] = [];

  for (const period of periods) {
    if (period.views_30d < 1) continue;
    const base = recentById.get(period.video_id);
    if (!base) continue;
    ranked.push({
      ...base,
      views_2d: period.views_2d,
      views_5d: period.views_5d,
      views_7d: period.views_7d,
      views_30d: period.views_30d,
      rank: 0,
      video_id: base.id,
    });
  }

  ranked.sort(compareTrendingItems);
  return ranked.slice(0, TRENDING_MAX_ITEMS).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}
