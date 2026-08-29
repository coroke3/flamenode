/**
 * GA4 trending 同期: list/recent.json → GA4 report → rank → analytics/trending.json。
 * 失敗時は R2 put しない（fail-closed）。D1 は使わない。
 */
import { ExternalRequestBudget } from "../shared/externalApi.ts";
import { safeErrorSummary } from "../shared/safeLog.ts";
import {
  STATIC_R2_MAX_AGE_SEC,
  staticR2CacheControl,
} from "../shared/staticR2CacheControl.ts";
import {
  fetchVideoViewPeriods,
  formatGa4QuotaLogFields,
} from "./dataApi.ts";
import type { Ga4DataApiEnv } from "./dataApi.ts";
import { rankTrendingItems } from "./ranking.ts";
import type { RecentListPayload, TrendingItem } from "./ranking.ts";

export const GA4_RECENT_LIST_KEY = "list/recent.json";
export const GA4_TRENDING_OUTPUT_KEY = "analytics/trending.json";
export const GA4_TRENDING_CACHE_CONTROL = staticR2CacheControl(
  STATIC_R2_MAX_AGE_SEC.trending,
  3600,
);
export const TRENDING_SCHEMA_VERSION = 1;
export const TRENDING_RANKING_RULE = [
  "views_2d_desc",
  "views_5d_desc",
  "views_7d_desc",
  "views_30d_desc",
  "video_id_asc",
] as const;

export interface TrendingWindowRange {
  start_date: string;
  end_date: string;
}

export interface TrendingOutputPayload {
  schema_version: number;
  generated_at: number;
  source: "ga4";
  ranking_rule: readonly string[];
  windows: {
    views_2d: TrendingWindowRange;
    views_5d: TrendingWindowRange;
    views_7d: TrendingWindowRange;
    views_30d: TrendingWindowRange;
  };
  items: TrendingItem[];
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDaysAgo(days: number, now = new Date()): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return formatUtcDate(date);
}

export function buildTrendingWindows(now = new Date()): TrendingOutputPayload["windows"] {
  const endDate = formatUtcDate(now);
  return {
    views_2d: { start_date: utcDaysAgo(1, now), end_date: endDate },
    views_5d: { start_date: utcDaysAgo(4, now), end_date: endDate },
    views_7d: { start_date: utcDaysAgo(6, now), end_date: endDate },
    views_30d: { start_date: utcDaysAgo(29, now), end_date: endDate },
  };
}

function countMatchedVideos(
  recent: RecentListPayload,
  periods: readonly { video_id: string; views_30d: number }[],
): number {
  if (!Array.isArray(recent.items)) return 0;
  const recentIds = new Set<string>();
  for (const item of recent.items) {
    if (item && typeof item === "object" && typeof item.id === "string" && item.id.trim()) {
      recentIds.add(item.id.trim());
    }
  }
  let matched = 0;
  for (const period of periods) {
    if (period.views_30d >= 1 && recentIds.has(period.video_id)) {
      matched += 1;
    }
  }
  return matched;
}

export interface Ga4TrendingSyncEnv extends Ga4DataApiEnv {
  R2: R2Bucket;
  GA4_SYNC_ENABLED?: string;
}

export interface Ga4TrendingSyncResult {
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
}

function isGa4SyncEnabled(env: Ga4TrendingSyncEnv): boolean {
  return env.GA4_SYNC_ENABLED?.trim() === "1";
}

function hasRequiredGa4Config(env: Ga4TrendingSyncEnv): boolean {
  return Boolean(
    env.GA4_PROPERTY_ID?.trim() &&
      env.GA4_SERVICE_ACCOUNT_EMAIL?.trim() &&
      env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY?.trim() &&
      env.R2 &&
      env.KV,
  );
}

function emptyResult(
  counters: Pick<Ga4TrendingSyncResult, "processed" | "failed" | "skipped">,
): Ga4TrendingSyncResult {
  return {
    ...counters,
    external_api_calls: 0,
    d1_changes: 0,
    retry_count: 0,
  };
}

function logGa4TrendingEvent(
  event: Record<string, unknown>,
): void {
  console.log(JSON.stringify(event));
}

async function loadRecentListPayload(
  env: Ga4TrendingSyncEnv,
  signal?: AbortSignal,
): Promise<RecentListPayload> {
  signal?.throwIfAborted();
  const object = await env.R2.get(GA4_RECENT_LIST_KEY);
  signal?.throwIfAborted();
  if (!object) throw new Error("ga4_recent_list_missing");
  const text = await object.text();
  signal?.throwIfAborted();
  try {
    return JSON.parse(text) as RecentListPayload;
  } catch {
    throw new Error("ga4_recent_list_invalid_json");
  }
}

async function loadExistingTrendingItemCount(
  env: Ga4TrendingSyncEnv,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const object = await env.R2.get(GA4_TRENDING_OUTPUT_KEY);
  signal?.throwIfAborted();
  if (!object) return 0;
  const text = await object.text();
  signal?.throwIfAborted();
  try {
    const payload = JSON.parse(text) as TrendingOutputPayload;
    return Array.isArray(payload.items) ? payload.items.length : 0;
  } catch {
    return 0;
  }
}

async function putTrendingPayload(
  env: Ga4TrendingSyncEnv,
  payload: TrendingOutputPayload,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await env.R2.put(GA4_TRENDING_OUTPUT_KEY, JSON.stringify(payload), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: GA4_TRENDING_CACHE_CONTROL,
    },
  });
  signal?.throwIfAborted();
}

export async function syncGa4Trending(
  env: Ga4TrendingSyncEnv,
  signal?: AbortSignal,
): Promise<Ga4TrendingSyncResult> {
  signal?.throwIfAborted();
  const enabled = isGa4SyncEnabled(env);
  if (!enabled) {
    logGa4TrendingEvent({
      service: "flamenode-sync-jobs",
      worker: "sync-jobs",
      job: "ga4-trending-sync",
      enabled: false,
      result: "skipped",
    });
    return emptyResult({ processed: 0, failed: 0, skipped: 1 });
  }
  if (!hasRequiredGa4Config(env)) {
    logGa4TrendingEvent({
      service: "flamenode-sync-jobs",
      worker: "sync-jobs",
      job: "ga4-trending-sync",
      enabled: true,
      result: "failed",
      error_name: "config_missing",
      r2_written: false,
    });
    return emptyResult({ processed: 0, failed: 1, skipped: 0 });
  }

  // OAuth token exchange と runReport ページングで共有する外部 API 予算
  const budget = new ExternalRequestBudget(16);
  const startedAt = Date.now();

  try {
    const recent = await loadRecentListPayload(env, signal);
    const { periods, quota } = await fetchVideoViewPeriods(
      env,
      budget,
      fetch,
      signal,
    );
    if (
      periods.length === 0 &&
      Array.isArray(recent.items) &&
      recent.items.length > 0
    ) {
      const existingItemCount = await loadExistingTrendingItemCount(env, signal);
      if (existingItemCount > 0) {
        throw new Error("ga4_empty_report_preserving_existing");
      }
    }
    const items = rankTrendingItems(recent, periods);
    const generatedAt = Math.floor(Date.now() / 1000);
    const outputPayload: TrendingOutputPayload = {
      schema_version: TRENDING_SCHEMA_VERSION,
      generated_at: generatedAt,
      source: "ga4",
      ranking_rule: [...TRENDING_RANKING_RULE],
      windows: buildTrendingWindows(),
      items,
    };
    await putTrendingPayload(env, outputPayload, signal);

    logGa4TrendingEvent({
      service: "flamenode-sync-jobs",
      worker: "sync-jobs",
      job: "ga4-trending-sync",
      enabled: true,
      result: "ok",
      generated_at: generatedAt,
      ga_rows: periods.length,
      matched_videos: countMatchedVideos(recent, periods),
      ranked_videos: items.length,
      r2_written: true,
      external_api_calls: budget.used,
      duration_ms: Date.now() - startedAt,
      ...formatGa4QuotaLogFields(quota),
    });

    return {
      processed: items.length,
      failed: 0,
      skipped: 0,
      external_api_calls: budget.used,
      d1_changes: 0,
      retry_count: 0,
    };
  } catch (error) {
    signal?.throwIfAborted();
    logGa4TrendingEvent({
      service: "flamenode-sync-jobs",
      worker: "sync-jobs",
      job: "ga4-trending-sync",
      enabled: true,
      result: "failed",
      r2_written: false,
      error: safeErrorSummary(error),
      external_api_calls: budget.used,
      duration_ms: Date.now() - startedAt,
    });
    throw error;
  }
}
