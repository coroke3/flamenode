/**
 * background-jobs から利用する期限駆動YouTubeメタデータ同期。
 * 1実行1 APIリクエスト、最大50動画、保存はJSON1を使う1 SQLに固定する。
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

export interface SyncBatchOptions {
  limit?: number;
  realtimeOnly?: boolean;
  now?: number;
}

type SyncRow = {
  id: string;
  youtube_video_id: string;
  visibility_status: string;
  scheduled_time: number | null;
  created_at: number;
  consecutive_failures: number;
};

type YoutubeItem = {
  id: string;
  statistics?: { viewCount?: string };
  status?: { privacyStatus?: string };
  contentDetails?: { duration?: string };
};

type PersistRow = {
  video_id: string;
  youtube_video_id: string;
  youtube_privacy_status: string | null;
  youtube_availability_status: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  synced_at: number;
  next_sync_at: number;
  consecutive_failures: number;
  sync_status: "synced" | "failed";
  sync_error: string | null;
  updated_at: number;
};

export const YOUTUBE_SYNC_BATCH_SIZE = 50;
export const YOUTUBE_SYNC_REALTIME_BATCH_SIZE = 10;
export const YOUTUBE_SYNC_FETCH_TIMEOUT_MS = 8_000;
export const YOUTUBE_SYNC_MAX_ATTEMPTS = 3;
export const YOUTUBE_SYNC_MAX_RETRY_DELAY_MS = 15_000;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const RETRYABLE_YOUTUBE_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

export function isRetryableYoutubeStatus(
  status: number,
): boolean {
  return RETRYABLE_YOUTUBE_STATUSES.has(status);
}

export function parseRetryAfterMs(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(
      seconds * 1_000,
      YOUTUBE_SYNC_MAX_RETRY_DELAY_MS,
    );
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  return Math.min(
    Math.max(0, timestamp - now),
    YOUTUBE_SYNC_MAX_RETRY_DELAY_MS,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

async function fetchYoutubeItems(
  url: string,
  fetchImpl: FetchLike,
): Promise<YoutubeItem[]> {
  let lastError = "unknown";

  for (
    let attempt = 0;
    attempt < YOUTUBE_SYNC_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      YOUTUBE_SYNC_FETCH_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      const timeoutError =
        error instanceof Error &&
        error.name === "AbortError";
      lastError = timeoutError
        ? "transient:youtube_api_timeout"
        : "transient:youtube_api_network_error";

      if (attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS) {
        throw new Error(lastError);
      }
      await wait(
        Math.min(
          1_000 * 2 ** attempt,
          YOUTUBE_SYNC_MAX_RETRY_DELAY_MS,
        ),
      );
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      try {
        const data = (await response.json()) as {
          items?: YoutubeItem[];
        };
        return data.items ?? [];
      } catch {
        throw new Error(
          "permanent:youtube_api_invalid_json",
        );
      }
    }

    const retryable = isRetryableYoutubeStatus(
      response.status,
    );
    lastError = `${
      retryable ? "transient" : "permanent"
    }:youtube_api_http_${response.status}`;

    if (
      !retryable ||
      attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS
    ) {
      throw new Error(lastError);
    }

    const retryAfter = parseRetryAfterMs(
      response.headers.get("retry-after"),
    );
    await wait(
      retryAfter ??
        Math.min(
          1_000 * 2 ** attempt,
          YOUTUBE_SYNC_MAX_RETRY_DELAY_MS,
        ),
    );
  }

  throw new Error(lastError);
}

function boundedLimit(
  value: number | undefined,
  realtimeOnly: boolean,
): number {
  const fallback = realtimeOnly
    ? YOUTUBE_SYNC_REALTIME_BATCH_SIZE
    : YOUTUBE_SYNC_BATCH_SIZE;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(
    YOUTUBE_SYNC_BATCH_SIZE,
    Math.max(1, Math.floor(value ?? fallback)),
  );
}

async function selectSyncRows(
  env: Env,
  now: number,
  limit: number,
  realtimeOnly: boolean,
): Promise<SyncRow[]> {
  const realtimeWhere = realtimeOnly
    ? `AND (
         ym.video_id IS NULL
         OR ym.youtube_video_id IS NOT v.youtube_video_id
         OR v.created_at >= ?2
         OR v.scheduled_time >= ?2
         OR EXISTS (
           SELECT 1
           FROM video_events ve
           INNER JOIN events e ON e.id = ve.event_id
           WHERE ve.video_id = v.id
             AND e.visibility_status = 'public'
             AND (e.start_time IS NULL OR e.start_time <= ?1)
             AND (e.end_time IS NULL OR e.end_time >= ?1)
         )
       )`
    : "";
  const result = await env.DB.prepare(
    `SELECT v.id,
            v.youtube_video_id,
            v.visibility_status,
            v.scheduled_time,
            v.created_at,
            COALESCE(ym.consecutive_failures, 0) AS consecutive_failures
       FROM videos v
       LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
      WHERE v.youtube_video_id IS NOT NULL
        AND v.youtube_video_id <> ''
        AND v.visibility_status NOT IN ('archived', 'voided')
        AND (
          ym.video_id IS NULL
          OR ym.youtube_video_id IS NOT v.youtube_video_id
          OR ym.next_sync_at IS NULL
          OR ym.next_sync_at <= ?1
        )
        ${realtimeWhere}
      ORDER BY
        CASE
          WHEN ym.video_id IS NULL OR ym.youtube_video_id IS NOT v.youtube_video_id
            THEN 0
          ELSE 1
        END,
        COALESCE(ym.next_sync_at, 0) ASC,
        COALESCE(v.scheduled_time, v.created_at) DESC,
        v.id ASC
      LIMIT ?3`,
  )
    .bind(now, now - DAY, limit)
    .all<SyncRow>();
  return (result.results ?? []).filter(
    (row) => Boolean(row.youtube_video_id),
  );
}

function successInterval(row: SyncRow, now: number): number {
  const recentBoundary = now - 7 * DAY;
  const nearBoundary = now - DAY;
  if (row.created_at >= nearBoundary) return HOUR;
  if ((row.scheduled_time ?? 0) >= nearBoundary) return HOUR;
  if ((row.scheduled_time ?? 0) >= recentBoundary) return 6 * HOUR;
  return DAY;
}

function failureInterval(failures: number): number {
  if (failures <= 1) return HOUR;
  if (failures === 2) return 6 * HOUR;
  if (failures === 3) return DAY;
  return 3 * DAY;
}

async function persistResults(
  env: Env,
  rows: readonly PersistRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.prepare(
    `INSERT INTO video_youtube_metadata (
       video_id,
       youtube_video_id,
       youtube_privacy_status,
       youtube_availability_status,
       duration_seconds,
       view_count,
       synced_at,
       next_sync_at,
       consecutive_failures,
       sync_status,
       sync_error,
       updated_at
     )
     SELECT
       json_extract(value, '$.video_id'),
       json_extract(value, '$.youtube_video_id'),
       json_extract(value, '$.youtube_privacy_status'),
       json_extract(value, '$.youtube_availability_status'),
       CAST(json_extract(value, '$.duration_seconds') AS INTEGER),
       COALESCE(CAST(json_extract(value, '$.view_count') AS INTEGER), 0),
       CAST(json_extract(value, '$.synced_at') AS INTEGER),
       CAST(json_extract(value, '$.next_sync_at') AS INTEGER),
       CAST(json_extract(value, '$.consecutive_failures') AS INTEGER),
       json_extract(value, '$.sync_status'),
       json_extract(value, '$.sync_error'),
       CAST(json_extract(value, '$.updated_at') AS INTEGER)
     FROM json_each(?1)
     WHERE true
     ON CONFLICT(video_id) DO UPDATE SET
       youtube_video_id = excluded.youtube_video_id,
       youtube_privacy_status = CASE
         WHEN excluded.sync_status = 'synced'
           THEN excluded.youtube_privacy_status
         ELSE video_youtube_metadata.youtube_privacy_status
       END,
       youtube_availability_status = CASE
         WHEN excluded.sync_status = 'synced'
           THEN excluded.youtube_availability_status
         ELSE video_youtube_metadata.youtube_availability_status
       END,
       duration_seconds = CASE
         WHEN excluded.sync_status = 'synced'
           THEN excluded.duration_seconds
         ELSE video_youtube_metadata.duration_seconds
       END,
       view_count = CASE
         WHEN excluded.sync_status = 'synced'
           THEN excluded.view_count
         ELSE video_youtube_metadata.view_count
       END,
       synced_at = excluded.synced_at,
       next_sync_at = excluded.next_sync_at,
       consecutive_failures = excluded.consecutive_failures,
       sync_status = excluded.sync_status,
       sync_error = excluded.sync_error,
       updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(rows))
    .run();
}

function failedRows(
  rows: readonly SyncRow[],
  now: number,
  error: string,
): PersistRow[] {
  return rows.map((row) => {
    const failures = Math.max(0, Number(row.consecutive_failures) || 0) + 1;
    return {
      video_id: row.id,
      youtube_video_id: row.youtube_video_id,
      youtube_privacy_status: null,
      youtube_availability_status: null,
      duration_seconds: null,
      view_count: null,
      synced_at: now,
      next_sync_at: now + failureInterval(failures),
      consecutive_failures: failures,
      sync_status: "failed",
      sync_error: error,
      updated_at: now,
    };
  });
}

/**
 * 期限到来分だけを最大50件取得し、YouTube API 1系列とD1集合UPSERT 1回で処理する。
 */
export async function syncBatch(
  env: Env,
  options: SyncBatchOptions = {},
  fetchImpl: FetchLike = fetch,
): Promise<SyncBatchResult> {
  if (!env.YOUTUBE_API_KEY?.trim()) {
    return { processed: 0, failed: 0, skipped: 1 };
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const realtimeOnly = options.realtimeOnly === true;
  const rows = await selectSyncRows(
    env,
    now,
    boundedLimit(options.limit, realtimeOnly),
    realtimeOnly,
  );
  if (rows.length === 0) {
    return { processed: 0, failed: 0, skipped: 1 };
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("key", env.YOUTUBE_API_KEY);
  url.searchParams.set("part", "statistics,status,contentDetails");
  url.searchParams.set(
    "id",
    rows.map((row) => row.youtube_video_id).join(","),
  );

  let youtubeItems: YoutubeItem[];
  try {
    youtubeItems = await fetchYoutubeItems(
      url.toString(),
      fetchImpl,
    );
  } catch (error) {
    const summary = safeErrorSummary(error);
    await persistResults(env, failedRows(rows, now, summary));
    return { processed: 0, failed: rows.length, skipped: 0 };
  }

  const items = new Map(
    youtubeItems.map((item) => [item.id, item]),
  );
  let processed = 0;
  let failed = 0;
  const persist: PersistRow[] = [];

  for (const row of rows) {
    const item = items.get(row.youtube_video_id);
    if (!item) {
      persist.push(
        ...failedRows(
          [row],
          now,
          "permanent:youtube_video_missing_or_private",
        ),
      );
      failed += 1;
      continue;
    }

    const privacy = item.status?.privacyStatus ?? null;
    persist.push({
      video_id: row.id,
      youtube_video_id: row.youtube_video_id,
      youtube_privacy_status: privacy,
      youtube_availability_status: privacy,
      duration_seconds: parseDuration(
        item.contentDetails?.duration ?? "",
      ),
      view_count: Number(item.statistics?.viewCount ?? 0),
      synced_at: now,
      next_sync_at: now + successInterval(row, now),
      consecutive_failures: 0,
      sync_status: "synced",
      sync_error: null,
      updated_at: now,
    });
    processed += 1;
  }

  await persistResults(env, persist);
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
