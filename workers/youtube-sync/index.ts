/**
 * sync-jobs から利用する YouTube メタデータ同期モジュール。
 * Worker entry point は持たず、Cron 統合 Workerだけが実行する。
 */

import {
  cancelResponseBody,
  delay,
  exponentialBackoffMs,
  ExternalRequestBudget,
  fetchWithTimeout,
  parseRetryAfterMs as parseSharedRetryAfterMs,
  type FetchLike,
} from "../shared/externalApi.ts";
import {
  refundYoutubeQuota,
  reserveYoutubeQuota,
  type YoutubeQuotaEnv,
} from "./quotaBudget.ts";

export interface Env extends YoutubeQuotaEnv {
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
export const YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN = 4;
export const YOUTUBE_SYNC_MAX_ROWS_PER_RUN =
  YOUTUBE_SYNC_BATCH_SIZE * YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN;
export const YOUTUBE_SYNC_FETCH_TIMEOUT_MS = 8_000;
export const YOUTUBE_SYNC_MAX_ATTEMPTS = 2;
export const YOUTUBE_SYNC_MAX_RETRY_DELAY_MS = 15_000;
/** 4 batch x 最大2 attempts。Workers Freeの外部subrequest 50件に対して42件の余裕を残す。 */
export const YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN =
  YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN * YOUTUBE_SYNC_MAX_ATTEMPTS;

const ACTIVE_SYNC_INTERVAL_SEC = 60 * 60;
const DEFAULT_SYNC_INTERVAL_SEC = 24 * 60 * 60;
const ACTIVE_EVENT_GRACE_SEC = 24 * 60 * 60;
/** D1の1 query最大100 bindingsに合わせ、10列 x 10行で固定する。 */
const BULK_UPSERT_ROWS = 10;
const YOUTUBE_QUOTA_COOLDOWN_SEC = 60 * 60;
const YOUTUBE_QUOTA_COOLDOWN_KEY = "external-api:youtube:quota-cooldown-until";

const RETRYABLE_YOUTUBE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const YOUTUBE_QUOTA_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "dailyLimitExceededUnreg",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

export function isRetryableYoutubeStatus(status: number): boolean {
  return RETRYABLE_YOUTUBE_STATUSES.has(status);
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  return parseSharedRetryAfterMs(value, YOUTUBE_SYNC_MAX_RETRY_DELAY_MS, now);
}

async function readYoutubeErrorReason(response: Response): Promise<string | null> {
  try {
    const data = (await response.json()) as {
      error?: { errors?: Array<{ reason?: unknown }> };
    };
    const reason = data.error?.errors?.[0]?.reason;
    return typeof reason === "string" ? reason : null;
  } catch {
    await cancelResponseBody(response);
    return null;
  }
}

async function quotaCooldownActive(env: Env, now: number): Promise<boolean> {
  try {
    const raw = await env.KV.get(YOUTUBE_QUOTA_COOLDOWN_KEY);
    const until = Number(raw);
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

async function activateQuotaCooldown(env: Env, now: number): Promise<void> {
  try {
    await env.KV.put(
      YOUTUBE_QUOTA_COOLDOWN_KEY,
      String(now + YOUTUBE_QUOTA_COOLDOWN_SEC),
      { expirationTtl: YOUTUBE_QUOTA_COOLDOWN_SEC },
    );
  } catch {
    // quotaエラー自体を優先し、KV障害で上書きしない。
  }
}

async function fetchYoutubeItems(
  url: string,
  env: Env,
  budget: ExternalRequestBudget,
  fetchImpl: FetchLike,
): Promise<YoutubeItem[]> {
  let lastError: Error = new Error("transient:youtube_api_unknown");

  for (let attempt = 0; attempt < YOUTUBE_SYNC_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        { headers: { accept: "application/json" } },
        {
          timeoutMs: YOUTUBE_SYNC_FETCH_TIMEOUT_MS,
          budget,
          budgetErrorCode: "transient:youtube_api_request_budget_exhausted",
          timeoutErrorCode: "transient:youtube_api_timeout",
          networkErrorCode: "transient:youtube_api_network_error",
        },
        fetchImpl,
      );
    } catch (error) {
      lastError = error instanceof Error
        ? error
        : new Error("transient:youtube_api_network_error");
      if (attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS || budget.remaining <= 0) {
        throw lastError;
      }
      await delay(
        exponentialBackoffMs(attempt, {
          maxDelayMs: YOUTUBE_SYNC_MAX_RETRY_DELAY_MS,
        }),
      );
      continue;
    }

    if (response.ok) {
      try {
        const data = (await response.json()) as { items?: YoutubeItem[] };
        return data.items ?? [];
      } catch {
        throw new Error("permanent:youtube_api_invalid_json");
      }
    }

    const reason = await readYoutubeErrorReason(response);
    if (reason && YOUTUBE_QUOTA_REASONS.has(reason) && response.status !== 429) {
      await activateQuotaCooldown(env, Math.floor(Date.now() / 1000));
      throw new Error(`quota:youtube_api_${reason}`);
    }

    const retryable = isRetryableYoutubeStatus(response.status);
    lastError = new Error(
      `${retryable ? "transient" : "permanent"}:youtube_api_http_${response.status}${reason ? `_${reason}` : ""}`,
    );
    if (!retryable || attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS || budget.remaining <= 0) {
      await cancelResponseBody(response);
      throw lastError;
    }

    const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
    await cancelResponseBody(response);
    await delay(
      exponentialBackoffMs(attempt, {
        maxDelayMs: YOUTUBE_SYNC_MAX_RETRY_DELAY_MS,
        retryAfterMs: retryAfter,
      }),
    );
  }

  throw lastError;
}

function appendUniqueRows(target: Map<string, SyncRow>, rows: readonly SyncRow[]): void {
  for (const row of rows) {
    if (!row.youtube_video_id || target.has(row.id)) continue;
    target.set(row.id, row);
  }
}

async function querySyncRows(
  env: Env,
  sql: string,
  bindings: readonly (string | number | null)[],
): Promise<SyncRow[]> {
  const result = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<SyncRow>();
  return result.results ?? [];
}

/** pending・開催中・通常期限をindex queryへ分け、合計200件まで取得する。 */
async function selectSyncRows(env: Env, now: number): Promise<SyncRow[]> {
  const selected = new Map<string, SyncRow>();

  appendUniqueRows(
    selected,
    await querySyncRows(
      env,
      `SELECT v.id, v.youtube_video_id
         FROM video_youtube_metadata ym
         INNER JOIN videos v ON v.id = ym.video_id
        WHERE ym.sync_status = 'pending'
          AND v.youtube_video_id IS NOT NULL
          AND v.youtube_video_id <> ''
          AND v.visibility_status <> 'voided'
        ORDER BY COALESCE(ym.synced_at, 0) ASC, v.id ASC
        LIMIT ?1`,
      [YOUTUBE_SYNC_MAX_ROWS_PER_RUN],
    ),
  );

  let remaining = YOUTUBE_SYNC_MAX_ROWS_PER_RUN - selected.size;
  if (remaining > 0) {
    appendUniqueRows(
      selected,
      await querySyncRows(
        env,
        `SELECT v.id, v.youtube_video_id
           FROM events e
           INNER JOIN videos v ON v.primary_event_id = e.id
           INNER JOIN video_youtube_metadata ym ON ym.video_id = v.id
          WHERE e.visibility_status = 'public'
            AND (e.start_time IS NOT NULL OR e.end_time IS NOT NULL)
            AND (e.start_time IS NULL OR e.start_time <= ?1 + ?3)
            AND (e.end_time IS NULL OR e.end_time >= ?1 - ?3)
            AND v.youtube_video_id IS NOT NULL
            AND v.youtube_video_id <> ''
            AND v.visibility_status <> 'voided'
            AND ym.sync_status IN ('synced', 'failed')
            AND ym.youtube_video_id IS v.youtube_video_id
            AND ym.synced_at IS NOT NULL
            AND ym.synced_at <= ?1 - ?2
          ORDER BY ym.synced_at ASC, v.id ASC
          LIMIT ?4`,
        [now, ACTIVE_SYNC_INTERVAL_SEC, ACTIVE_EVENT_GRACE_SEC, remaining],
      ),
    );
  }

  remaining = YOUTUBE_SYNC_MAX_ROWS_PER_RUN - selected.size;
  if (remaining > 0) {
    appendUniqueRows(
      selected,
      await querySyncRows(
        env,
        `SELECT v.id, v.youtube_video_id
           FROM video_youtube_metadata ym
           INNER JOIN videos v ON v.id = ym.video_id
          WHERE ym.sync_status IN ('synced', 'failed')
            AND ym.synced_at IS NOT NULL
            AND ym.synced_at <= ?1 - ?2
            AND ym.youtube_video_id IS v.youtube_video_id
            AND v.youtube_video_id IS NOT NULL
            AND v.youtube_video_id <> ''
            AND v.visibility_status <> 'voided'
          ORDER BY ym.synced_at ASC, v.id ASC
          LIMIT ?3`,
        [now, DEFAULT_SYNC_INTERVAL_SEC, remaining],
      ),
    );
  }

  return [...selected.values()];
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

function splitRows(rows: SyncRow[]): SyncRow[][] {
  const chunks: SyncRow[][] = [];
  for (let offset = 0; offset < rows.length; offset += YOUTUBE_SYNC_BATCH_SIZE) {
    chunks.push(rows.slice(offset, offset + YOUTUBE_SYNC_BATCH_SIZE));
  }
  return chunks.slice(0, YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN);
}

export async function syncBatch(
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<SyncBatchResult> {
  const apiKey = env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return { processed: 0, failed: 0, skipped: 1 };

  const now = Math.floor(Date.now() / 1000);
  if (await quotaCooldownActive(env, now)) {
    return { processed: 0, failed: 0, skipped: 1 };
  }

  const rows = await selectSyncRows(env, now);
  if (rows.length === 0) return { processed: 0, failed: 0, skipped: 1 };

  const chunks = splitRows(rows);
  const plannedQuotaUnits = chunks.length * YOUTUBE_SYNC_MAX_ATTEMPTS;
  const reservation = await reserveYoutubeQuota(env, plannedQuotaUnits, now);
  if (!reservation) return { processed: 0, failed: 0, skipped: 1 };

  const budget = new ExternalRequestBudget(YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN);
  try {
    const itemMap = new Map<string, YoutubeItem>();
    for (const chunk of chunks) {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("part", "statistics,status,contentDetails");
      url.searchParams.set(
        "fields",
        "items(id,statistics/viewCount,status/privacyStatus,contentDetails/duration)",
      );
      url.searchParams.set("prettyPrint", "false");
      url.searchParams.set("id", chunk.map((row) => row.youtube_video_id).join(","));

      const items = await fetchYoutubeItems(url.toString(), env, budget, fetchImpl);
      for (const item of items) itemMap.set(item.id, item);
    }

    const writes = buildMetadataWrites(rows, itemMap);
    await persistMetadataBatch(env, writes, now);
    return { processed: writes.length, failed: 0, skipped: 0 };
  } finally {
    await refundYoutubeQuota(
      env,
      reservation,
      reservation.reservedUnits - budget.used,
      Math.floor(Date.now() / 1000),
    );
  }
}

export function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  return Number.parseInt(match[1] ?? "0", 10) * 3600
    + Number.parseInt(match[2] ?? "0", 10) * 60
    + Number.parseInt(match[3] ?? "0", 10);
}
