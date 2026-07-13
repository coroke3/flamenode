/**
 * sync-jobs から利用する YouTube メタデータ同期モジュール。
 * Worker entry point は持たず、Cron 統合 Workerだけが実行する。
 */

import { normalizeLegacyVideoCursor } from "../shared/legacyCursor.ts";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  /** 既存互換の主キー */
  YOUTUBE_API_KEY?: string;
  /** credential障害時だけ使用する副キー */
  YOUTUBE_API_KEY_SECONDARY?: string;
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

export type YoutubeApiKeyLabel = "primary" | "secondary";
export type YoutubeApiErrorKind =
  | "quota"
  | "credential"
  | "transient"
  | "permanent";

export type YoutubeApiKeyCandidate = {
  label: YoutubeApiKeyLabel;
  key: string;
};

type YoutubeApiKeyStatus = {
  version: 1;
  configured: YoutubeApiKeyLabel[];
  active_key: YoutubeApiKeyLabel | null;
  disabled_until: Partial<Record<YoutubeApiKeyLabel, number>>;
  last_failover_at: number | null;
  last_failover_from: YoutubeApiKeyLabel | null;
  last_failure_kind: YoutubeApiErrorKind | null;
  last_failure_reason: string | null;
  updated_at: number;
};

export const YOUTUBE_SYNC_BATCH_SIZE = 50;
export const YOUTUBE_SYNC_BATCHES_PER_RUN = 1;
export const YOUTUBE_SYNC_FETCH_TIMEOUT_MS = 8_000;
export const YOUTUBE_SYNC_MAX_ATTEMPTS = 2;
export const YOUTUBE_SYNC_MAX_RETRY_DELAY_MS = 15_000;
export const YOUTUBE_SYNC_MAX_KEY_CANDIDATES = 2;
export const YOUTUBE_API_KEY_DISABLE_SEC = 6 * 60 * 60;
export const YOUTUBE_API_KEY_STATUS_KV = "youtube-api:key-status:v1";

const ACTIVE_SYNC_INTERVAL_SEC = 60 * 60;
const DEFAULT_SYNC_INTERVAL_SEC = 24 * 60 * 60;
const ACTIVE_EVENT_GRACE_SEC = 24 * 60 * 60;
const BULK_UPSERT_ROWS = 8;

const RETRYABLE_YOUTUBE_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);
const QUOTA_ERROR_REASONS = new Set([
  "quotaexceeded",
  "dailylimitexceeded",
  "dailylimitexceededunreg",
  "ratelimitexceeded",
  "userratelimitexceeded",
  "resource_exhausted",
]);
const CREDENTIAL_ERROR_REASONS = new Set([
  "keyinvalid",
  "apikeyinvalid",
  "api_key_invalid",
  "keyexpired",
  "accessnotconfigured",
  "servicedisabled",
  "service_disabled",
  "iprefererblocked",
]);

class YoutubeApiRequestError extends Error {
  constructor(
    readonly kind: YoutubeApiErrorKind,
    readonly reason: string,
    readonly status: number,
  ) {
    super(`${kind}:youtube_api_${reason}`);
    this.name = "YoutubeApiRequestError";
  }
}

export function normalizeYoutubeSyncCursor(value: string | null): string {
  return normalizeLegacyVideoCursor(value);
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function normalizedReason(reason: string | null | undefined): string {
  return (reason ?? "").trim().toLowerCase();
}

export function isRetryableYoutubeStatus(status: number): boolean {
  return RETRYABLE_YOUTUBE_STATUSES.has(status);
}

export function classifyYoutubeApiError(
  status: number,
  reason: string | null | undefined,
): YoutubeApiErrorKind {
  const normalized = normalizedReason(reason);
  if (QUOTA_ERROR_REASONS.has(normalized)) return "quota";
  if (CREDENTIAL_ERROR_REASONS.has(normalized)) return "credential";
  if (isRetryableYoutubeStatus(status)) return "transient";
  return "permanent";
}

/**
 * 複数projectのquotaを合算する目的では切り替えない。
 * 副キーは主キーの失効・API未有効化・key restriction不整合などに限定する。
 */
export function shouldFailoverYoutubeApiKey(
  status: number,
  reason: string | null | undefined,
): boolean {
  return classifyYoutubeApiError(status, reason) === "credential";
}

export function resolveYoutubeApiKeys(
  env: Pick<Env, "YOUTUBE_API_KEY" | "YOUTUBE_API_KEY_SECONDARY">,
): YoutubeApiKeyCandidate[] {
  const candidates: YoutubeApiKeyCandidate[] = [];
  const primary = env.YOUTUBE_API_KEY?.trim();
  const secondary = env.YOUTUBE_API_KEY_SECONDARY?.trim();

  if (primary) candidates.push({ label: "primary", key: primary });
  if (
    secondary &&
    !candidates.some((candidate) => candidate.key === secondary)
  ) {
    candidates.push({ label: "secondary", key: secondary });
  }
  return candidates.slice(0, YOUTUBE_SYNC_MAX_KEY_CANDIDATES);
}

export function orderYoutubeApiKeys(
  candidates: readonly YoutubeApiKeyCandidate[],
  disabledUntil: Partial<Record<YoutubeApiKeyLabel, number>>,
  now: number,
): YoutubeApiKeyCandidate[] {
  const enabled = candidates.filter(
    (candidate) => Number(disabledUntil[candidate.label] ?? 0) <= now,
  );
  return enabled.length > 0 ? enabled : [...candidates];
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type YoutubeErrorPayload = {
  error?: {
    status?: unknown;
    errors?: Array<{ reason?: unknown }>;
  };
};

async function readYoutubeApiErrorReason(
  response: Response,
): Promise<string | null> {
  try {
    const payload = (await response.json()) as YoutubeErrorPayload;
    const detail = payload.error?.errors?.find(
      (item) => typeof item.reason === "string",
    );
    if (
      typeof detail?.reason === "string" &&
      detail.reason.trim()
    ) {
      return detail.reason.trim();
    }
    if (
      typeof payload.error?.status === "string" &&
      payload.error.status.trim()
    ) {
      return payload.error.status.trim();
    }
  } catch {
    // エラーbodyがJSONでない場合はHTTP statusだけで分類する。
  }
  return null;
}

function emptyKeyStatus(
  candidates: readonly YoutubeApiKeyCandidate[],
  now: number,
): YoutubeApiKeyStatus {
  return {
    version: 1,
    configured: candidates.map((candidate) => candidate.label),
    active_key: null,
    disabled_until: {},
    last_failover_at: null,
    last_failover_from: null,
    last_failure_kind: null,
    last_failure_reason: null,
    updated_at: now,
  };
}

function parseKeyStatus(
  raw: string | null,
  candidates: readonly YoutubeApiKeyCandidate[],
  now: number,
): YoutubeApiKeyStatus {
  const fallback = emptyKeyStatus(candidates, now);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<YoutubeApiKeyStatus>;
    const disabledUntil = parsed.disabled_until;
    return {
      ...fallback,
      active_key:
        parsed.active_key === "primary" ||
        parsed.active_key === "secondary"
          ? parsed.active_key
          : null,
      disabled_until:
        disabledUntil && typeof disabledUntil === "object"
          ? {
              primary: Number.isFinite(disabledUntil.primary)
                ? Number(disabledUntil.primary)
                : undefined,
              secondary: Number.isFinite(disabledUntil.secondary)
                ? Number(disabledUntil.secondary)
                : undefined,
            }
          : {},
      last_failover_at: Number.isFinite(parsed.last_failover_at)
        ? Number(parsed.last_failover_at)
        : null,
      last_failover_from:
        parsed.last_failover_from === "primary" ||
        parsed.last_failover_from === "secondary"
          ? parsed.last_failover_from
          : null,
      last_failure_kind:
        parsed.last_failure_kind === "quota" ||
        parsed.last_failure_kind === "credential" ||
        parsed.last_failure_kind === "transient" ||
        parsed.last_failure_kind === "permanent"
          ? parsed.last_failure_kind
          : null,
      last_failure_reason:
        typeof parsed.last_failure_reason === "string"
          ? parsed.last_failure_reason.slice(0, 100)
          : null,
      updated_at: Number.isFinite(parsed.updated_at)
        ? Number(parsed.updated_at)
        : now,
    };
  } catch {
    return fallback;
  }
}

async function loadKeyStatus(
  env: Env,
  candidates: readonly YoutubeApiKeyCandidate[],
  now: number,
): Promise<YoutubeApiKeyStatus> {
  try {
    return parseKeyStatus(
      await env.KV.get(YOUTUBE_API_KEY_STATUS_KV),
      candidates,
      now,
    );
  } catch {
    return emptyKeyStatus(candidates, now);
  }
}

async function saveKeyStatus(
  env: Env,
  status: YoutubeApiKeyStatus,
): Promise<void> {
  try {
    await env.KV.put(
      YOUTUBE_API_KEY_STATUS_KV,
      JSON.stringify(status),
      { expirationTtl: 30 * 24 * 60 * 60 },
    );
  } catch {
    // 監視用KVの失敗で同期本体を止めない。
  }
}

async function fetchYoutubeItems(
  url: URL,
  fetchImpl: FetchLike,
): Promise<YoutubeItem[]> {
  let lastError: YoutubeApiRequestError | null = null;
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
        error instanceof Error && error.name === "AbortError";
      lastError = new YoutubeApiRequestError(
        "transient",
        timeoutError ? "timeout" : "network_error",
        0,
      );
      if (attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS) {
        throw lastError;
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
        throw new YoutubeApiRequestError(
          "permanent",
          "invalid_json",
          response.status,
        );
      }
    }

    const reason = await readYoutubeApiErrorReason(response);
    const kind = classifyYoutubeApiError(response.status, reason);
    const safeReason =
      normalizedReason(reason) || `http_${response.status}`;
    lastError = new YoutubeApiRequestError(
      kind,
      safeReason,
      response.status,
    );

    // 429は同じキーでRetry-Afterに従う。quota系を別キーへ逃がすことはしない。
    const retrySameKey =
      kind === "transient" ||
      (kind === "quota" && response.status === 429);
    if (
      !retrySameKey ||
      attempt + 1 >= YOUTUBE_SYNC_MAX_ATTEMPTS
    ) {
      throw lastError;
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
  throw (
    lastError ??
    new YoutubeApiRequestError("permanent", "unknown", 0)
  );
}

async function fetchYoutubeItemsWithFailover(
  env: Env,
  baseUrl: URL,
  candidates: readonly YoutubeApiKeyCandidate[],
  fetchImpl: FetchLike,
  now: number,
): Promise<YoutubeItem[]> {
  const status = await loadKeyStatus(env, candidates, now);
  const ordered = orderYoutubeApiKeys(
    candidates,
    status.disabled_until,
    now,
  );
  let lastError: unknown;

  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    const url = new URL(baseUrl);
    url.searchParams.set("key", candidate.key);
    try {
      const items = await fetchYoutubeItems(url, fetchImpl);
      delete status.disabled_until[candidate.label];
      status.configured = candidates.map((item) => item.label);
      status.active_key = candidate.label;
      status.updated_at = now;
      await saveKeyStatus(env, status);
      return items;
    } catch (error) {
      lastError = error;
      const requestError =
        error instanceof YoutubeApiRequestError ? error : null;
      status.configured = candidates.map((item) => item.label);
      status.last_failure_kind = requestError?.kind ?? "permanent";
      status.last_failure_reason =
        requestError?.reason ?? "unknown";
      status.updated_at = now;

      const hasFallback = index + 1 < ordered.length;
      const credentialFailure =
        requestError?.kind === "credential";
      if (credentialFailure) {
        status.disabled_until[candidate.label] =
          now + YOUTUBE_API_KEY_DISABLE_SEC;
      }
      if (hasFallback && credentialFailure) {
        status.last_failover_at = now;
        status.last_failover_from = candidate.label;
        await saveKeyStatus(env, status);
        continue;
      }
      await saveKeyStatus(env, status);
      throw error;
    }
  }

  throw (
    lastError ??
    new YoutubeApiRequestError("permanent", "api_key_missing", 0)
  );
}

function appendUniqueRows(
  target: Map<string, SyncRow>,
  rows: readonly SyncRow[],
): void {
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

/**
 * 未同期・開催中・通常期限を別queryに分け、既存indexを利用する。
 * OR条件を含む単一queryでvideos全体を走査せず、最大3 query・50件に固定する。
 */
async function selectSyncRows(
  env: Env,
  now: number,
): Promise<SyncRow[]> {
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
          AND v.visibility_status NOT IN ('archived', 'voided')
        ORDER BY COALESCE(ym.synced_at, 0) ASC, v.id ASC
        LIMIT ?1`,
      [YOUTUBE_SYNC_BATCH_SIZE],
    ),
  );

  let remaining = YOUTUBE_SYNC_BATCH_SIZE - selected.size;
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
            AND v.visibility_status NOT IN ('archived', 'voided')
            AND ym.sync_status IN ('synced', 'failed')
            AND ym.youtube_video_id IS v.youtube_video_id
            AND ym.synced_at IS NOT NULL
            AND ym.synced_at <= ?1 - ?2
          ORDER BY ym.synced_at ASC, v.id ASC
          LIMIT ?4`,
        [
          now,
          ACTIVE_SYNC_INTERVAL_SEC,
          ACTIVE_EVENT_GRACE_SEC,
          remaining,
        ],
      ),
    );
  }

  remaining = YOUTUBE_SYNC_BATCH_SIZE - selected.size;
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
            AND v.visibility_status NOT IN ('archived', 'voided')
          ORDER BY ym.synced_at ASC, v.id ASC
          LIMIT ?3`,
        [now, DEFAULT_SYNC_INTERVAL_SEC, remaining],
      ),
    );
  }

  return [...selected.values()];
}

function buildMetadataWrites(
  rows: SyncRow[],
  items: Map<string, YoutubeItem>,
): MetadataWrite[] {
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
      durationSeconds: parseDuration(
        item.contentDetails?.duration ?? "",
      ),
      viewCount: Number(item.statistics?.viewCount ?? 0),
      syncStatus: "synced" as const,
      syncError: null,
    };
  });
}

async function persistMetadataBatch(
  env: Env,
  writes: MetadataWrite[],
  now: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (
    let offset = 0;
    offset < writes.length;
    offset += BULK_UPSERT_ROWS
  ) {
    const chunk = writes.slice(offset, offset + BULK_UPSERT_ROWS);
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ");
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
  const apiKeys = resolveYoutubeApiKeys(env);
  if (apiKeys.length === 0) {
    return { processed: 0, failed: 0, skipped: 1 };
  }

  let processed = 0;
  for (
    let batch = 0;
    batch < YOUTUBE_SYNC_BATCHES_PER_RUN;
    batch += 1
  ) {
    const now = Math.floor(Date.now() / 1000);
    const rows = await selectSyncRows(env, now);
    if (rows.length === 0) break;
    const url = new URL(
      "https://www.googleapis.com/youtube/v3/videos",
    );
    url.searchParams.set(
      "part",
      "statistics,status,contentDetails",
    );
    url.searchParams.set(
      "id",
      rows.map((row) => row.youtube_video_id).join(","),
    );
    const youtubeItems = await fetchYoutubeItemsWithFailover(
      env,
      url,
      apiKeys,
      fetchImpl,
      now,
    );
    const writes = buildMetadataWrites(
      rows,
      new Map(youtubeItems.map((item) => [item.id, item])),
    );
    await persistMetadataBatch(env, writes, now);
    processed += writes.length;
  }
  return processed === 0
    ? { processed: 0, failed: 0, skipped: 1 }
    : { processed, failed: 0, skipped: 0 };
}

export function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(
    iso,
  );
  if (!match) return 0;
  return (
    Number.parseInt(match[1] ?? "0", 10) * 3600 +
    Number.parseInt(match[2] ?? "0", 10) * 60 +
    Number.parseInt(match[3] ?? "0", 10)
  );
}
