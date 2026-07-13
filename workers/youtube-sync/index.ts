/**
 * sync-jobs から利用する YouTube メタデータ同期モジュール。
 * Worker entry point は持たず、Cron 統合 Worker だけが実行する。
 */

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

type MetadataWrite = {
  videoId: string;
  youtubeVideoId: string;
  privacyStatus: string | null;
  availabilityStatus: string | null;
  durationSeconds: number;
  viewCount: number;
  syncStatus: "synced" | "failed";
  syncError: string | null;
};

export const YOUTUBE_SYNC_BATCH_SIZE = 50;
export const YOUTUBE_SYNC_BATCHES_PER_RUN = 1;
export const YOUTUBE_SYNC_FETCH_TIMEOUT_MS = 8_000;
export const YOUTUBE_SYNC_MAX_ATTEMPTS = 2;
export const YOUTUBE_SYNC_MAX_RETRY_DELAY_MS = 15_000;

const ACTIVE_SYNC_INTERVAL_SEC = 60 * 60;
const DEFAULT_SYNC_INTERVAL_SEC = 24 * 60 * 60;
const ACTIVE_EVENT_GRACE_SEC = 24 * 60 * 60;
const BULK_UPSERT_ROWS = 8;

export function normalizeYoutubeSyncCursor(value: string | null): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { last_video_id?: unknown };
    return typeof parsed.last_video_id === "string" ? parsed.last_video_id.trim() : "";
  } catch {
    return "";
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const RETRYABLE_YOUTUBE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableYoutubeStatus(status: number): boolean {
  return RETRYABLE_YOUTUBE_STATUSES.has(status);
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, YOUTUBE_SYNC_MAX_RETRY_DELAY_MS);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - now), YOUTUBE_SYNC_MAX_RETRY_DELAY_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchYoutubeItems(url: string, fetchImpl: FetchLike): Promise<YoutubeItem[]> {
  let lastError = "unknown";
  for (let attempt = 0; attempt < YOUTUBE_SYNC_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), YOUTUBE_SYNC_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      const timeoutError = error instanceof Error && error.name === "AbortError";
      lastError = timeoutError
        ? "transient:youtube_api_timeout"
        : "transient:youtube_api_network_error";
      if (attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS) throw new Error(lastError);
      await wait(Math.min(1_000 * 2 ** attempt, YOUTUBE_SYNC_MAX_RETRY_DELAY_MS));
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      try {
        const data = (await response.json()) as { items?: YoutubeItem[] };
        return data.items ?? [];
      } catch {
        throw new Error("permanent:youtube_api_invalid_json");
      }
    }

    const retryable = isRetryableYoutubeStatus(response.status);
    lastError = `${retryable ? "transient" : "permanent"}:youtube_api_http_${response.status}`;
    if (!retryable || attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS) {
      throw new Error(lastError);
    }
    const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
    await wait(retryAfter ?? Math.min(1_000 * 2 ** attempt, YOUTUBE_SYNC_MAX_RETRY_DELAY_MS));
  }
  throw new Error(lastError);
}

async function selectSyncRows(env: Env, now: number): Promise<SyncRow[]> {
  const result = await env.DB.prepare(
    `SELECT v.id, v.youtube_video_id
       FROM videos v
       LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
       LEFT JOIN events e ON e.id = v.primary_event_id
      WHERE v.youtube_video_id IS NOT NULL
        AND v.youtube_video_id <> ''
        AND v.visibility_status NOT IN ('archived', 'voided')
        AND (
          ym.synced_at IS NULL
          OR ym.synced_at <= CASE
            WHEN e.visibility_status = 'public'
             AND (e.start_time IS NOT NULL OR e.end_time IS NOT NULL)
             AND (e.start_time IS NULL OR e.start_time <= ?1 + ?4)
             AND (e.end_time IS NULL OR e.end_time >= ?1 - ?4)
            THEN ?2 ELSE ?3 END
        )
      ORDER BY
        CASE WHEN ym.synced_at IS NULL THEN 0 ELSE 1 END,
        CASE
          WHEN e.visibility_status = 'public'
           AND (e.start_time IS NOT NULL OR e.end_time IS NOT NULL)
           AND (e.start_time IS NULL OR e.start_time <= ?1 + ?4)
           AND (e.end_time IS NULL OR e.end_time >= ?1 - ?4)
          THEN 0 ELSE 1 END,
        COALESCE(ym.synced_at, 0) ASC,
        v.id ASC
      LIMIT ?5`,
  )
    .bind(
      now,
      now - ACTIVE_SYNC_INTERVAL_SEC,
      now - DEFAULT_SYNC_INTERVAL_SEC,
      ACTIVE_EVENT_GRACE_SEC,
      YOUTUBE_SYNC_BATCH_SIZE,
    )
    .all<SyncRow>();
  return (result.results ?? []).filter((row) => row.youtube_video_id);
}

function buildMetadataWrites(rows: SyncRow[], items: Map<string, YoutubeItem>): MetadataWrite[] {
  return rows.map((row) => {
    const item = items.get(row.youtube_video_id);
    if (!item) {
      return {
        videoId: row.id,
        youtubeVideoId: row.youtube_video_id,
        privacyStatus: null,
        availabilityStatus: null,
        durationSeconds: 0,
        viewCount: 0,
        syncStatus: "failed" as const,
        syncError: "permanent:youtube_video_missing_or_private",
      };
    }
    return {
      videoId: row.id,
      youtubeVideoId: row.youtube_video_id,
      privacyStatus: item.status?.privacyStatus ?? null,
      availabilityStatus: item.status?.privacyStatus ?? null,
      durationSeconds: parseDuration(item.contentDetails?.duration ?? ""),
      viewCount: Number(item.statistics?.viewCount ?? 0),
      syncStatus: "synced" as const,
      syncError: null,
    };
  });
}

async function persistMetadataBatch(env: Env, writes: MetadataWrite[], now: number): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < writes.length; offset += BULK_UPSERT_ROWS) {
    const chunk = writes.slice(offset, offset + BULK_UPSERT_ROWS);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = chunk.flatMap((row) => [
      row.videoId,
      row.youtubeVideoId,
      row.privacyStatus,
      row.availabilityStatus,
      row.durationSeconds,
      row.viewCount,
      now,
      row.syncStatus,
      row.syncError,
      now,
    ]);
    statements.push(
      env.DB.prepare(
        `INSERT INTO video_youtube_metadata (
           video_id, youtube_video_id, youtube_privacy_status,
           youtube_availability_status, duration_seconds, view_count,
           synced_at, sync_status, sync_error, updated_at
         ) VALUES ${placeholders}
         ON CONFLICT(video_id) DO UPDATE SET
           youtube_video_id = excluded.youtube_video_id,
           youtube_privacy_status = CASE WHEN excluded.sync_status = 'synced'
             THEN excluded.youtube_privacy_status ELSE video_youtube_metadata.youtube_privacy_status END,
           youtube_availability_status = CASE WHEN excluded.sync_status = 'synced'
             THEN excluded.youtube_availability_status ELSE video_youtube_metadata.youtube_availability_status END,
           duration_seconds = CASE WHEN excluded.sync_status = 'synced'
             THEN excluded.duration_seconds ELSE video_youtube_metadata.duration_seconds END,
           view_count = CASE WHEN excluded.sync_status = 'synced'
             THEN excluded.view_count ELSE video_youtube_metadata.view_count END,
           synced_at = excluded.synced_at,
           sync_status = excluded.sync_status,
           sync_error = excluded.sync_error,
           updated_at = excluded.updated_at`,
      ).bind(...values),
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

export async function syncBatch(
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<SyncBatchResult> {
  if (!env.YOUTUBE_API_KEY?.trim()) return { processed: 0, failed: 0, skipped: 1 };

  let processed = 0;
  for (let batch = 0; batch < YOUTUBE_SYNC_BATCHES_PER_RUN; batch += 1) {
    const now = Math.floor(Date.now() / 1000);
    const rows = await selectSyncRows(env, now);
    if (rows.length === 0) break;
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("key", env.YOUTUBE_API_KEY);
    url.searchParams.set("part", "statistics,status,contentDetails");
    url.searchParams.set("id", rows.map((row) => row.youtube_video_id).join(","));
    const youtubeItems = await fetchYoutubeItems(url.toString(), fetchImpl);
    const writes = buildMetadataWrites(rows, new Map(youtubeItems.map((item) => [item.id, item])));
    await persistMetadataBatch(env, writes, now);
    processed += writes.length;
  }
  return processed === 0
    ? { processed: 0, failed: 0, skipped: 1 }
    : { processed, failed: 0, skipped: 0 };
}

export function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  return Number.parseInt(match[1] ?? "0", 10) * 3600
    + Number.parseInt(match[2] ?? "0", 10) * 60
    + Number.parseInt(match[3] ?? "0", 10);
}
