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
  jobFailureWithCounters,
  type JobFailureWithCounters,
} from "../shared/runJob.ts";
import {
  refundYoutubeQuota,
  reserveYoutubeQuota,
  type YoutubeQuotaEnv,
} from "./quotaBudget.ts";

export interface Env extends YoutubeQuotaEnv {
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
}

export type SyncBatchMode =
  | "all"
  | "pending_only"
  | "scheduled_only"
  | "blocked_recheck_only";

export type SyncBatchOptions = {
  mode?: SyncBatchMode;
  maxVideos?: number;
  maxApiBatches?: number;
  /** Recovery Cron: Queue 無効時に pending も scheduled 枠へ含める。 */
  includePending?: boolean;
};

export interface SyncBatchResult {
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
  quota_stopped: boolean;
  quota_stop_reason: string | null;
  changed_video_ids: string[];
  /** related表示適格性が変わった動画（blocklist再生成トリガ）。 */
  related_eligibility_changed_video_ids: string[];
  has_more_pending: boolean;
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
  privacyStatus: string | null;
  availabilityStatus: string | null;
  /** public/unlisted成功時のみ非null。private/missing/transientはnullで既存値を維持。 */
  durationSeconds: number | null;
  viewCount: number | null;
  syncStatus: "synced" | "failed";
  syncError: string | null;
};

type ExistingMetadataRow = {
  video_id: string;
  view_count: number | null;
  duration_seconds: number | null;
  youtube_privacy_status: string | null;
  youtube_availability_status: string | null;
  sync_status: string | null;
};

export const YOUTUBE_SYNC_BATCH_SIZE = 50;
export const YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN = 4;
export const YOUTUBE_SYNC_MAX_ROWS_PER_RUN =
  YOUTUBE_SYNC_BATCH_SIZE * YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN;
export const YOUTUBE_PENDING_MAX_VIDEOS_PER_RUN = 50;
export const YOUTUBE_PENDING_MAX_API_BATCHES_PER_RUN = 1;
export const YOUTUBE_SYNC_FETCH_TIMEOUT_MS = 8_000;
export const YOUTUBE_SYNC_MAX_ATTEMPTS = 2;
export const YOUTUBE_SYNC_MAX_RETRY_DELAY_MS = 15_000;
/** 4 batch x 最大2 attempts。Workers Freeの外部subrequest 50件に対して42件の余裕を残す。 */
export const YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN =
  YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN * YOUTUBE_SYNC_MAX_ATTEMPTS;

const ACTIVE_SYNC_INTERVAL_SEC = 60 * 60;
const DEFAULT_SYNC_INTERVAL_SEC = 24 * 60 * 60;
const ACTIVE_EVENT_GRACE_SEC = 24 * 60 * 60;
/** blocked(private/missing)の復旧確認間隔。通常同期とは別予算。 */
const BLOCKED_RECHECK_INTERVAL_SEC = 7 * 24 * 60 * 60;
export const BLOCKED_RECHECK_MAX_VIDEOS_PER_RUN = 10;
/** synced_at: 最後にpublic/unlistedとして正常取得した時刻。failed時の期限はupdated_at。 */
const SYNC_ELIGIBILITY_TIMESTAMP_SQL = `COALESCE(
  CASE
    WHEN ym.sync_status = 'failed' THEN ym.updated_at
    ELSE ym.synced_at
  END,
  0
)`;
const NOT_BLOCKED_FOR_RELATED_SQL = `COALESCE(ym.youtube_privacy_status, '') <> 'private'
          AND COALESCE(ym.youtube_availability_status, '')
              NOT IN ('private', 'missing_or_private')`;
/** D1の1 query最大100 bindings未満になるよう、9列 x 10行（90 bindings）で固定する。 */
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

async function delayWithSignal(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await delay(ms);
    return;
  }
  signal.throwIfAborted();
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    }
    function done(): void {
      cleanup();
      resolve();
    }
    function aborted(): void {
      cleanup();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function readYoutubeErrorReason(
  response: Response,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const data = (await response.json()) as {
      error?: { errors?: Array<{ reason?: unknown }> };
    };
    signal?.throwIfAborted();
    const reason = data.error?.errors?.[0]?.reason;
    return typeof reason === "string" ? reason : null;
  } catch {
    signal?.throwIfAborted();
    await cancelResponseBody(response);
    return null;
  }
}

async function quotaCooldownActive(
  env: Env,
  now: number,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    const raw = await env.KV.get(YOUTUBE_QUOTA_COOLDOWN_KEY);
    signal?.throwIfAborted();
    const until = Number(raw);
    return Number.isFinite(until) && until > now;
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}

async function activateQuotaCooldown(
  env: Env,
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  try {
    await env.KV.put(
      YOUTUBE_QUOTA_COOLDOWN_KEY,
      String(now + YOUTUBE_QUOTA_COOLDOWN_SEC),
      { expirationTtl: YOUTUBE_QUOTA_COOLDOWN_SEC },
    );
    signal?.throwIfAborted();
  } catch {
    signal?.throwIfAborted();
    // quotaエラー自体を優先し、KV障害で上書きしない。
  }
}

async function fetchYoutubeItems(
  url: string,
  env: Env,
  budget: ExternalRequestBudget,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<YoutubeItem[]> {
  let lastError: Error = new Error("transient:youtube_api_unknown");

  for (let attempt = 0; attempt < YOUTUBE_SYNC_MAX_ATTEMPTS; attempt += 1) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        { headers: { accept: "application/json" }, signal },
        {
          timeoutMs: YOUTUBE_SYNC_FETCH_TIMEOUT_MS,
          budget,
          budgetErrorCode: "transient:youtube_api_request_budget_exhausted",
          timeoutErrorCode: "transient:youtube_api_timeout",
          networkErrorCode: "transient:youtube_api_network_error",
        },
        fetchImpl,
      );
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error instanceof Error
        ? error
        : new Error("transient:youtube_api_network_error");
      if (attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS || budget.remaining <= 0) {
        throw lastError;
      }
      await delayWithSignal(
        exponentialBackoffMs(attempt, {
          maxDelayMs: YOUTUBE_SYNC_MAX_RETRY_DELAY_MS,
        }),
        signal,
      );
      continue;
    }

    if (response.ok) {
      try {
        const data = (await response.json()) as { items?: YoutubeItem[] };
        signal?.throwIfAborted();
        return data.items ?? [];
      } catch {
        signal?.throwIfAborted();
        throw new Error("permanent:youtube_api_invalid_json");
      }
    }

    const reason = await readYoutubeErrorReason(response, signal);
    if (reason && YOUTUBE_QUOTA_REASONS.has(reason) && response.status !== 429) {
      await activateQuotaCooldown(
        env,
        Math.floor(Date.now() / 1000),
        signal,
      );
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
    await delayWithSignal(
      exponentialBackoffMs(attempt, {
        maxDelayMs: YOUTUBE_SYNC_MAX_RETRY_DELAY_MS,
        retryAfterMs: retryAfter,
      }),
      signal,
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
  signal?: AbortSignal,
): Promise<SyncRow[]> {
  signal?.throwIfAborted();
  const result = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<SyncRow>();
  signal?.throwIfAborted();
  return result.results ?? [];
}

/** pending 行だけを取得する（Queue consumer 専用）。 */
export async function selectPendingSyncRows(
  env: Env,
  limit: number,
  signal?: AbortSignal,
): Promise<SyncRow[]> {
  signal?.throwIfAborted();
  return querySyncRows(
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
    [limit],
    signal,
  );
}

/** 開催中・通常期限のみ（pending / blocked は含めない）。 */
async function selectScheduledSyncRows(
  env: Env,
  now: number,
  limit: number,
  signal?: AbortSignal,
): Promise<SyncRow[]> {
  signal?.throwIfAborted();
  const selected = new Map<string, SyncRow>();

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
          AND ${NOT_BLOCKED_FOR_RELATED_SQL}
          AND ym.sync_status IN ('synced', 'failed')
          AND NOT (
            ym.sync_status = 'failed'
            AND ym.sync_error LIKE 'permanent:%'
          )
          AND ${SYNC_ELIGIBILITY_TIMESTAMP_SQL} <= ?1 - ?2
        ORDER BY ${SYNC_ELIGIBILITY_TIMESTAMP_SQL} ASC, v.id ASC
        LIMIT ?4`,
      [now, ACTIVE_SYNC_INTERVAL_SEC, ACTIVE_EVENT_GRACE_SEC, limit],
      signal,
    ),
  );

  const remaining = limit - selected.size;
  if (remaining > 0) {
    appendUniqueRows(
      selected,
      await querySyncRows(
        env,
        `SELECT v.id, v.youtube_video_id
           FROM video_youtube_metadata ym
           INNER JOIN videos v ON v.id = ym.video_id
          WHERE ym.sync_status IN ('synced', 'failed')
            AND NOT (
              ym.sync_status = 'failed'
              AND ym.sync_error LIKE 'permanent:%'
            )
            AND ${NOT_BLOCKED_FOR_RELATED_SQL}
            AND ${SYNC_ELIGIBILITY_TIMESTAMP_SQL} <= ?1 - ?2
            AND v.youtube_video_id IS NOT NULL
            AND v.youtube_video_id <> ''
            AND v.visibility_status <> 'voided'
          ORDER BY ${SYNC_ELIGIBILITY_TIMESTAMP_SQL} ASC, v.id ASC
          LIMIT ?3`,
        [now, DEFAULT_SYNC_INTERVAL_SEC, remaining],
        signal,
      ),
    );
  }

  return [...selected.values()];
}

/**
 * private / missing_or_private の週次復旧確認。
 * 通常同期とは別予算。sync-jobs が1日1回呼び出す想定。
 */
export async function selectBlockedRecheckRows(
  env: Env,
  now: number,
  limit: number = BLOCKED_RECHECK_MAX_VIDEOS_PER_RUN,
  signal?: AbortSignal,
): Promise<SyncRow[]> {
  signal?.throwIfAborted();
  return querySyncRows(
    env,
    `SELECT v.id, v.youtube_video_id
       FROM video_youtube_metadata ym
       INNER JOIN videos v ON v.id = ym.video_id
      WHERE v.youtube_video_id IS NOT NULL
        AND v.youtube_video_id <> ''
        AND v.visibility_status <> 'voided'
        AND (
          ym.youtube_privacy_status = 'private'
          OR ym.youtube_availability_status IN (
            'private',
            'missing_or_private'
          )
        )
        AND ym.updated_at <= ?1 - ?2
      ORDER BY ym.updated_at ASC, v.id ASC
      LIMIT ?3`,
    [now, BLOCKED_RECHECK_INTERVAL_SEC, limit],
    signal,
  );
}

/** pending・開催中・通常期限をindex queryへ分け、合計200件まで取得する。 */
async function selectSyncRows(
  env: Env,
  now: number,
  signal: AbortSignal | undefined,
  options: SyncBatchOptions,
): Promise<SyncRow[]> {
  signal?.throwIfAborted();
  const mode = options.mode ?? "all";
  const maxVideos = options.maxVideos ?? YOUTUBE_SYNC_MAX_ROWS_PER_RUN;

  if (mode === "pending_only") {
    return selectPendingSyncRows(env, maxVideos, signal);
  }

  if (mode === "blocked_recheck_only") {
    return selectBlockedRecheckRows(env, now, maxVideos, signal);
  }

  if (mode === "scheduled_only") {
    if (options.includePending) {
      const selected = new Map<string, SyncRow>();
      appendUniqueRows(
        selected,
        await selectPendingSyncRows(env, maxVideos, signal),
      );
      const remaining = maxVideos - selected.size;
      if (remaining > 0) {
        appendUniqueRows(
          selected,
          await selectScheduledSyncRows(env, now, remaining, signal),
        );
      }
      return [...selected.values()];
    }
    return selectScheduledSyncRows(env, now, maxVideos, signal);
  }

  const selected = new Map<string, SyncRow>();

  appendUniqueRows(
    selected,
    await selectPendingSyncRows(env, maxVideos, signal),
  );

  let remaining = maxVideos - selected.size;
  if (remaining > 0) {
    appendUniqueRows(
      selected,
      await selectScheduledSyncRows(env, now, remaining, signal),
    );
  }

  return [...selected.values()];
}

export async function countPendingSyncRows(
  env: Env,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS pending_count
       FROM video_youtube_metadata ym
       INNER JOIN videos v ON v.id = ym.video_id
      WHERE ym.sync_status = 'pending'
        AND v.youtube_video_id IS NOT NULL
        AND v.youtube_video_id <> ''
        AND v.visibility_status <> 'voided'`,
  ).first<{ pending_count: number }>();
  signal?.throwIfAborted();
  return Math.max(0, Number(row?.pending_count ?? 0));
}

async function loadExistingMetadata(
  env: Env,
  videoIds: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, ExistingMetadataRow>> {
  signal?.throwIfAborted();
  const map = new Map<string, ExistingMetadataRow>();
  if (videoIds.length === 0) return map;
  const placeholders = videoIds.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT video_id, view_count, duration_seconds,
            youtube_privacy_status, youtube_availability_status, sync_status
       FROM video_youtube_metadata
      WHERE video_id IN (${placeholders})`,
  )
    .bind(...videoIds)
    .all<ExistingMetadataRow>();
  signal?.throwIfAborted();
  for (const row of result.results ?? []) {
    map.set(row.video_id, row);
  }
  return map;
}

function metadataValueChanged(
  before: ExistingMetadataRow | undefined,
  write: MetadataWrite,
): boolean {
  if (!before) return write.syncStatus === "synced";
  if (before.sync_status === "pending" && write.syncStatus === "synced") {
    return true;
  }
  if (write.syncStatus !== "synced") return false;
  if (
    write.privacyStatus !== "public" &&
    write.privacyStatus !== "unlisted"
  ) {
    return false;
  }
  return (
    (write.viewCount != null &&
      Number(before.view_count ?? 0) !== write.viewCount)
    || (write.durationSeconds != null &&
      Number(before.duration_seconds ?? 0) !== write.durationSeconds)
    || (before.youtube_privacy_status ?? null) !== write.privacyStatus
    || (before.youtube_availability_status ?? null) !== write.availabilityStatus
  );
}

function isBlockedForRelated(args: {
  privacyStatus: string | null | undefined;
  availabilityStatus: string | null | undefined;
}): boolean {
  return (
    args.privacyStatus === "private"
    || args.availabilityStatus === "private"
    || args.availabilityStatus === "missing_or_private"
  );
}

/** raw writeではなく、永続化後の実効privacy/availabilityで適格性を比較する。 */
function resolveEffectiveAvailability(
  before: ExistingMetadataRow | undefined,
  write: MetadataWrite,
): {
  privacyStatus: string | null;
  availabilityStatus: string | null;
} {
  return {
    privacyStatus:
      write.privacyStatus ?? before?.youtube_privacy_status ?? null,
    availabilityStatus:
      write.availabilityStatus ??
      before?.youtube_availability_status ??
      null,
  };
}

function collectRelatedEligibilityChangedVideoIds(
  writes: MetadataWrite[],
  existing: Map<string, ExistingMetadataRow>,
): string[] {
  const changed: string[] = [];
  for (const write of writes) {
    const before = existing.get(write.videoId);
    const after = resolveEffectiveAvailability(before, write);
    const blockedBefore = isBlockedForRelated({
      privacyStatus: before?.youtube_privacy_status,
      availabilityStatus: before?.youtube_availability_status,
    });
    const blockedAfter = isBlockedForRelated(after);
    if (blockedBefore !== blockedAfter) changed.push(write.videoId);
  }
  return changed;
}

function collectChangedVideoIds(
  writes: MetadataWrite[],
  existing: Map<string, ExistingMetadataRow>,
): string[] {
  const changed: string[] = [];
  for (const write of writes) {
    if (metadataValueChanged(existing.get(write.videoId), write)) {
      changed.push(write.videoId);
    }
  }
  return changed;
}

function buildMetadataWrites(rows: SyncRow[], items: Map<string, YoutubeItem>): MetadataWrite[] {
  return rows.map((row) => {
    const item = items.get(row.youtube_video_id);
    if (!item) {
      return {
        videoId: row.id,
        privacyStatus: null,
        availabilityStatus: "missing_or_private",
        durationSeconds: null,
        viewCount: null,
        syncStatus: "failed" as const,
        syncError: "permanent:youtube_video_missing_or_private",
      };
    }
    const privacyStatus = item.status?.privacyStatus ?? null;
    if (privacyStatus === "private") {
      return {
        videoId: row.id,
        privacyStatus: "private",
        availabilityStatus: "private",
        durationSeconds: null,
        viewCount: null,
        syncStatus: "synced" as const,
        syncError: null,
      };
    }
    return {
      videoId: row.id,
      privacyStatus,
      availabilityStatus: privacyStatus,
      durationSeconds: parseDuration(item.contentDetails?.duration ?? ""),
      viewCount: Number(item.statistics?.viewCount ?? 0),
      syncStatus: "synced" as const,
      syncError: null,
    };
  });
}

function buildChunkFailureWrites(
  rows: readonly SyncRow[],
  error: unknown,
): MetadataWrite[] {
  const message = error instanceof Error
    ? error.message
    : "permanent:youtube_api_unknown";
  return rows.map((row) => ({
    videoId: row.id,
    privacyStatus: null,
    availabilityStatus: null,
    durationSeconds: null,
    viewCount: null,
    syncStatus: "failed" as const,
    syncError: message,
  }));
}

function isYoutubeQuotaError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("quota:youtube_api_");
}

async function persistMetadataBatch(
  env: Env,
  writes: MetadataWrite[],
  now: number,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < writes.length; offset += BULK_UPSERT_ROWS) {
    signal?.throwIfAborted();
    const chunk = writes.slice(offset, offset + BULK_UPSERT_ROWS);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = chunk.flatMap((row) => [
      row.videoId,
      row.privacyStatus,
      row.availabilityStatus,
      row.durationSeconds,
      // INSERT時だけNOT NULL制約を満たす。既存行はCASEで維持する。
      row.viewCount ?? 0,
      now,
      row.syncStatus,
      row.syncError,
      now,
    ]);
    statements.push(
      env.DB.prepare(
        `INSERT INTO video_youtube_metadata (
           video_id, youtube_privacy_status,
           youtube_availability_status, duration_seconds, view_count,
           synced_at, sync_status, sync_error, updated_at
         ) VALUES ${placeholders}
         ON CONFLICT(video_id) DO UPDATE SET
           youtube_privacy_status = CASE
             WHEN excluded.youtube_privacy_status IS NOT NULL
               THEN excluded.youtube_privacy_status
             ELSE video_youtube_metadata.youtube_privacy_status
           END,
           youtube_availability_status = CASE
             WHEN excluded.youtube_availability_status IS NOT NULL
               THEN excluded.youtube_availability_status
             ELSE video_youtube_metadata.youtube_availability_status
           END,
           duration_seconds = CASE
             WHEN excluded.sync_status = 'synced'
              AND excluded.youtube_privacy_status IN ('public', 'unlisted')
              AND excluded.duration_seconds IS NOT NULL
               THEN excluded.duration_seconds
             ELSE video_youtube_metadata.duration_seconds
           END,
           view_count = CASE
             WHEN excluded.sync_status = 'synced'
              AND excluded.youtube_privacy_status IN ('public', 'unlisted')
               THEN excluded.view_count
             ELSE video_youtube_metadata.view_count
           END,
           synced_at = CASE
             WHEN excluded.sync_status = 'synced'
              AND excluded.youtube_privacy_status IN ('public', 'unlisted')
               THEN excluded.synced_at
             ELSE video_youtube_metadata.synced_at
           END,
           sync_status = excluded.sync_status,
           sync_error = excluded.sync_error,
           updated_at = excluded.updated_at`,
      ).bind(...values),
    );
  }
  signal?.throwIfAborted();
  if (statements.length > 0) {
    const results = await env.DB.batch(statements);
    signal?.throwIfAborted();
    return results.reduce((sum, result) => sum + Math.max(0, Number(result?.meta?.changes ?? 0)), 0);
  }
  return 0;
}

function splitRows(
  rows: SyncRow[],
  maxApiBatches: number,
): SyncRow[][] {
  const chunks: SyncRow[][] = [];
  for (let offset = 0; offset < rows.length; offset += YOUTUBE_SYNC_BATCH_SIZE) {
    chunks.push(rows.slice(offset, offset + YOUTUBE_SYNC_BATCH_SIZE));
  }
  return chunks.slice(0, maxApiBatches);
}

function resolveSyncBatchLimits(options: SyncBatchOptions = {}): {
  mode: SyncBatchMode;
  maxVideos: number;
  maxApiBatches: number;
  includePending: boolean;
} {
  const mode = options.mode ?? "all";
  if (mode === "pending_only") {
    return {
      mode,
      maxVideos: options.maxVideos ?? YOUTUBE_PENDING_MAX_VIDEOS_PER_RUN,
      maxApiBatches: options.maxApiBatches ?? YOUTUBE_PENDING_MAX_API_BATCHES_PER_RUN,
      includePending: false,
    };
  }
  if (mode === "blocked_recheck_only") {
    return {
      mode,
      maxVideos: options.maxVideos ?? BLOCKED_RECHECK_MAX_VIDEOS_PER_RUN,
      maxApiBatches: options.maxApiBatches ?? 1,
      includePending: false,
    };
  }
  return {
    mode,
    maxVideos: options.maxVideos ?? YOUTUBE_SYNC_MAX_ROWS_PER_RUN,
    maxApiBatches: options.maxApiBatches ?? YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN,
    includePending: options.includePending === true,
  };
}

function emptySyncBatchResult(
  result: Pick<SyncBatchResult, "processed" | "failed" | "skipped">,
  extra: Partial<SyncBatchResult> = {},
): SyncBatchResult {
  return {
    external_api_calls: 0,
    d1_changes: 0,
    retry_count: 0,
    quota_stopped: false,
    quota_stop_reason: null,
    changed_video_ids: [],
    related_eligibility_changed_video_ids: [],
    has_more_pending: false,
    ...result,
    ...extra,
  };
}

export async function syncPendingBatch(
  env: Env,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<SyncBatchResult> {
  return syncBatch(env, fetchImpl, signal, { mode: "pending_only" });
}

export async function syncBatch(
  env: Env,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
  options: SyncBatchOptions = {},
): Promise<SyncBatchResult> {
  signal?.throwIfAborted();
  const limits = resolveSyncBatchLimits(options);
  const empty = (
    result: Pick<SyncBatchResult, "processed" | "failed" | "skipped">,
    extra: Partial<SyncBatchResult> = {},
  ): SyncBatchResult => emptySyncBatchResult(result, extra);
  const apiKey = env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return empty({ processed: 0, failed: 0, skipped: 1 });

  const now = Math.floor(Date.now() / 1000);
  if (await quotaCooldownActive(env, now, signal)) {
    return empty(
      { processed: 0, failed: 0, skipped: 1 },
      { quota_stopped: true, quota_stop_reason: "youtube_quota_cooldown" },
    );
  }

  const rows = await selectSyncRows(env, now, signal, {
    mode: limits.mode,
    maxVideos: limits.maxVideos,
    includePending: limits.includePending,
  });
  if (rows.length === 0) return empty({ processed: 0, failed: 0, skipped: 1 });

  const chunks = splitRows(rows, limits.maxApiBatches);
  const plannedQuotaUnits = chunks.length * YOUTUBE_SYNC_MAX_ATTEMPTS;
  const reservation = await reserveYoutubeQuota(
    env,
    plannedQuotaUnits,
    now,
    signal,
  );
  if (!reservation) {
    return empty(
      { processed: 0, failed: 0, skipped: 1 },
      { quota_stopped: true, quota_stop_reason: "youtube_quota_reservation_denied" },
    );
  }

  const maxExternalRequests =
    limits.maxApiBatches * YOUTUBE_SYNC_MAX_ATTEMPTS;
  const budget = new ExternalRequestBudget(maxExternalRequests);
  let reportedResult: SyncBatchResult | undefined;
  let reportedFailure: JobFailureWithCounters | undefined;
  let startedChunks = 0;
  const existingMetadata = await loadExistingMetadata(
    env,
    rows.map((row) => row.id),
    signal,
  );
  const itemMap = new Map<string, YoutubeItem>();
  const persistedVideoIds = new Set<string>();
  const committedWrites: MetadataWrite[] = [];
  let metadataD1Changes = 0;
  let quotaStopped = false;
  let quotaStopReason: string | null = null;

  try {
    for (const chunk of chunks) {
      signal?.throwIfAborted();
      const pendingChunk = chunk.filter((row) => !persistedVideoIds.has(row.id));
      if (pendingChunk.length === 0) continue;

      startedChunks += 1;
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("part", "statistics,status,contentDetails");
      url.searchParams.set(
        "fields",
        "items(id,statistics/viewCount,status/privacyStatus,contentDetails/duration)",
      );
      url.searchParams.set("prettyPrint", "false");
      url.searchParams.set(
        "id",
        pendingChunk.map((row) => row.youtube_video_id).join(","),
      );

      let chunkWrites: MetadataWrite[];
      try {
        const items = await fetchYoutubeItems(
          url.toString(),
          env,
          budget,
          fetchImpl,
          signal,
        );
        signal?.throwIfAborted();
        for (const item of items) itemMap.set(item.id, item);
        chunkWrites = buildMetadataWrites(pendingChunk, itemMap);
      } catch (error) {
        if (isYoutubeQuotaError(error)) {
          quotaStopped = true;
          quotaStopReason = "youtube_api_error";
          break;
        }
        signal?.throwIfAborted();
        chunkWrites = buildChunkFailureWrites(pendingChunk, error);
      }

      try {
        metadataD1Changes += await persistMetadataBatch(
          env,
          chunkWrites,
          now,
          signal,
        );
        signal?.throwIfAborted();
        for (const write of chunkWrites) persistedVideoIds.add(write.videoId);
        committedWrites.push(...chunkWrites);
      } catch (error) {
        signal?.throwIfAborted();
        reportedFailure = jobFailureWithCounters(error, {
          failed: 1,
          processed: committedWrites.length,
          external_api_calls: budget.used,
          d1_changes: metadataD1Changes + reservation.d1Changes,
          retry_count: Math.max(0, budget.used - startedChunks),
        });
        throw reportedFailure;
      }

      if (quotaStopped) break;
    }

    signal?.throwIfAborted();
    const changedVideoIds = collectChangedVideoIds(committedWrites, existingMetadata);
    const relatedEligibilityChangedVideoIds =
      collectRelatedEligibilityChangedVideoIds(
        committedWrites,
        existingMetadata,
      );
    let hasMorePending = false;
    if (limits.mode === "pending_only") {
      const remainingPending = await countPendingSyncRows(env, signal);
      hasMorePending = remainingPending > 0;
    }
    const skipped = rows.length - committedWrites.length;
    reportedResult = empty(
      {
        processed: committedWrites.length,
        failed: 0,
        skipped: skipped > 0 ? skipped : 0,
      },
      {
        external_api_calls: budget.used,
        d1_changes: metadataD1Changes,
        retry_count: Math.max(0, budget.used - startedChunks),
        changed_video_ids: changedVideoIds,
        related_eligibility_changed_video_ids:
          relatedEligibilityChangedVideoIds,
        has_more_pending: hasMorePending,
        quota_stopped: quotaStopped,
        quota_stop_reason: quotaStopReason,
      },
    );
    return reportedResult;
  } catch (error) {
    if (isYoutubeQuotaError(error)) {
      const changedVideoIds = collectChangedVideoIds(committedWrites, existingMetadata);
      const relatedEligibilityChangedVideoIds =
        collectRelatedEligibilityChangedVideoIds(
          committedWrites,
          existingMetadata,
        );
      reportedResult = empty(
        {
          processed: committedWrites.length,
          failed: 0,
          skipped: rows.length - committedWrites.length || 1,
        },
        {
          external_api_calls: budget.used,
          d1_changes: metadataD1Changes,
          retry_count: Math.max(0, budget.used - startedChunks),
          changed_video_ids: changedVideoIds,
          related_eligibility_changed_video_ids:
            relatedEligibilityChangedVideoIds,
          quota_stopped: true,
          quota_stop_reason: "youtube_api_error",
        },
      );
      return reportedResult;
    }
    signal?.throwIfAborted();
    if (error instanceof JobFailureWithCounters) {
      reportedFailure = error;
      throw reportedFailure;
    }
    reportedFailure = jobFailureWithCounters(error, {
      failed: 1,
      processed: committedWrites.length,
      external_api_calls: budget.used,
      d1_changes: metadataD1Changes + reservation.d1Changes,
      retry_count: Math.max(0, budget.used - startedChunks),
    });
    throw reportedFailure;
  } finally {
    if (!signal?.aborted) {
      const refundChanges = await refundYoutubeQuota(
        env,
        reservation,
        reservation.reservedUnits - budget.used,
        Math.floor(Date.now() / 1000),
        signal,
      );
      if (reportedResult) {
        reportedResult.d1_changes += reservation.d1Changes + refundChanges;
      }
      if (reportedFailure) {
        reportedFailure.counters.d1_changes =
          (reportedFailure.counters.d1_changes ?? 0) + refundChanges;
      }
    }
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
