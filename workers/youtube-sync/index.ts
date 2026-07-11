/**
 * sync-jobs から利用する YouTube メタデータ同期モジュール。
 * Worker entry point は持たず、Cron 統合 Worker だけが実行する。
 */

import { safeErrorSummary } from "../shared/safeLog.ts";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
}

export interface SyncBatchResult {
  processed: number;
  failed: number;
  skipped: number;
}

type SyncRow = { id: string; youtube_video_id: string };
type YoutubeItem = {
  id: string;
  statistics?: { viewCount?: string };
  status?: { privacyStatus?: string };
  contentDetails?: { duration?: string };
};

export const YOUTUBE_SYNC_BATCH_SIZE = 25;
const CURSOR_KEY = "sync-jobs:youtube:last-video-id";

export function normalizeYoutubeSyncCursor(value: string | null): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { last_video_id?: unknown };
    return typeof parsed.last_video_id === "string" ? parsed.last_video_id.trim() : "";
  } catch {
    return "";
  }
}

async function selectRowsAfterCursor(
  env: Env,
  cursor: string,
): Promise<SyncRow[]> {
  const result = await env.DB.prepare(
    `SELECT v.id, v.youtube_video_id
       FROM videos v
      WHERE v.youtube_video_id IS NOT NULL
        AND v.youtube_video_id <> ''
        AND v.visibility_status NOT IN ('archived', 'voided')
        AND v.id > ?1
      ORDER BY v.id ASC
      LIMIT ?2`,
  )
    .bind(cursor, YOUTUBE_SYNC_BATCH_SIZE)
    .all<SyncRow>();
  return (result.results ?? []).filter((row) => row.youtube_video_id);
}

/** 未同期作品を先に拾い、以後は永続 cursor で全件を循環する。 */
async function selectSyncRows(env: Env, cursor: string): Promise<SyncRow[]> {
  const pending = await env.DB.prepare(
    `SELECT v.id, v.youtube_video_id
       FROM videos v
       LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
      WHERE v.youtube_video_id IS NOT NULL
        AND v.youtube_video_id <> ''
        AND v.visibility_status NOT IN ('archived', 'voided')
        AND ym.synced_at IS NULL
      ORDER BY v.created_at ASC, v.id ASC
      LIMIT ?1`,
  )
    .bind(YOUTUBE_SYNC_BATCH_SIZE)
    .all<SyncRow>();
  const pendingRows = (pending.results ?? []).filter((row) => row.youtube_video_id);
  if (pendingRows.length > 0) return pendingRows;

  const continued = await selectRowsAfterCursor(env, cursor);
  if (continued.length > 0 || !cursor) return continued;
  return selectRowsAfterCursor(env, "");
}

async function saveYoutubeMetadata(
  env: Env,
  row: SyncRow,
  item: YoutubeItem,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO video_youtube_metadata (
       video_id, youtube_video_id, youtube_privacy_status,
       youtube_availability_status, duration_seconds, view_count,
       synced_at, sync_status, sync_error, updated_at
     ) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, 'synced', NULL, ?6)
     ON CONFLICT(video_id) DO UPDATE SET
       youtube_video_id = excluded.youtube_video_id,
       youtube_privacy_status = excluded.youtube_privacy_status,
       youtube_availability_status = excluded.youtube_availability_status,
       duration_seconds = excluded.duration_seconds,
       view_count = excluded.view_count,
       synced_at = excluded.synced_at,
       sync_status = 'synced',
       sync_error = NULL,
       updated_at = excluded.updated_at`,
  )
    .bind(
      row.id,
      row.youtube_video_id,
      item.status?.privacyStatus ?? null,
      parseDuration(item.contentDetails?.duration ?? ""),
      Number(item.statistics?.viewCount ?? 0),
      now,
    )
    .run();
}

async function markSyncFailure(
  env: Env,
  row: SyncRow,
  summary: string,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO video_youtube_metadata (
       video_id, youtube_video_id, view_count, synced_at,
       sync_status, sync_error, updated_at
     ) VALUES (?1, ?2, 0, ?3, 'failed', ?4, ?3)
     ON CONFLICT(video_id) DO UPDATE SET
       youtube_video_id = excluded.youtube_video_id,
       synced_at = excluded.synced_at,
       sync_status = 'failed',
       sync_error = excluded.sync_error,
       updated_at = excluded.updated_at`,
  )
    .bind(row.id, row.youtube_video_id, now, summary)
    .run();
}

/**
 * 1回の実行で最大25件。APIまたは個別DB書込みの失敗は安全な状態で次回へ回す。
 */
export async function syncBatch(env: Env): Promise<SyncBatchResult> {
  if (!env.YOUTUBE_API_KEY?.trim()) {
    return { processed: 0, failed: 0, skipped: 1 };
  }

  const cursor = normalizeYoutubeSyncCursor(await env.KV.get(CURSOR_KEY));
  const rows = await selectSyncRows(env, cursor);
  if (rows.length === 0) {
    await env.KV.put(CURSOR_KEY, JSON.stringify({ last_video_id: "" }), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
    return { processed: 0, failed: 0, skipped: 1 };
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("key", env.YOUTUBE_API_KEY);
  url.searchParams.set("part", "statistics,status,contentDetails");
  url.searchParams.set("id", rows.map((row) => row.youtube_video_id).join(","));
  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`YouTube API returned HTTP ${response.status}`);
  }

  let data: { items?: YoutubeItem[] };
  try {
    data = (await response.json()) as { items?: YoutubeItem[] };
  } catch {
    throw new Error("YouTube API response was invalid");
  }

  const items = new Map((data.items ?? []).map((item) => [item.id, item]));
  const now = Math.floor(Date.now() / 1000);
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    const item = items.get(row.youtube_video_id);
    try {
      if (!item) {
        await markSyncFailure(env, row, "YouTube response did not include the video", now);
        failed += 1;
        continue;
      }
      await saveYoutubeMetadata(env, row, item, now);
      processed += 1;
    } catch (error) {
      failed += 1;
      try {
        await markSyncFailure(env, row, safeErrorSummary(error), now);
      } catch {
        // 次の行と次回 Cron を止めない。生の例外はログへ出さない。
      }
    }
  }

  const lastVideoId = rows[rows.length - 1]?.id ?? "";
  await env.KV.put(CURSOR_KEY, JSON.stringify({ last_video_id: lastVideoId }), {
    expirationTtl: 30 * 24 * 60 * 60,
  });
  return { processed, failed, skipped: 0 };
}

export function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}
