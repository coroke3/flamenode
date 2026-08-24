import {
  loadYoutubeQuotaSnapshot,
  reserveYoutubeQuota,
  type YoutubeQuotaEnv,
} from "../youtube-sync/quotaBudget.ts";
import {
  cancelResponseBody,
  ExternalRequestBudget,
  fetchWithTimeout,
  type FetchLike,
} from "../shared/externalApi.ts";

export interface PlaylistSyncEnv extends YoutubeQuotaEnv {
  KV: KVNamespace;
  YOUTUBE_OAUTH_CLIENT_ID?: string;
  YOUTUBE_OAUTH_CLIENT_SECRET?: string;
  YOUTUBE_OAUTH_REFRESH_TOKEN?: string;
}

export type PlaylistSyncMode = "append_only" | "mirror";

export type PlaylistSyncTrigger =
  | "manual"
  | "settings_change"
  | "continuation"
  | "scheduled";

export interface PlaylistSyncRunContext {
  runId: string;
  trigger: PlaylistSyncTrigger;
  dispatchSource: string;
}

interface SyncConfigRow {
  event_id: string;
  playlist_id: string;
  sync_mode: PlaylistSyncMode;
  sync_interval_minutes: number;
  sync_status: string;
  next_sync_at: number | null;
  last_synced_at: number | null;
  last_full_scan_at: number | null;
  scan_started_at: number | null;
  scan_page_token: string | null;
  last_error: string | null;
  pending_trigger: PlaylistSyncTrigger | null;
}

export interface ClaimedSyncConfig extends SyncConfigRow {
  run_id: string;
  run_lease_expires_at: number;
  claimed_trigger: PlaylistSyncTrigger;
  dispatch_source: string;
  run_started_ms: number;
}

interface RemoteItemRow {
  playlist_item_id: string;
  youtube_video_id: string;
}

interface PlaylistPageItem {
  playlistItemId: string;
  videoId: string;
}

interface PlaylistPage {
  items: PlaylistPageItem[];
  nextPageToken: string | null;
}

interface InsertedPlaylistItem {
  id: string;
  ordered: boolean;
}

export type PlaylistOrderRepairPlan =
  | { status: "aligned" }
  | { status: "ambiguous" }
  | {
      status: "move";
      playlistItemId: string;
      videoId: string;
      fromIndex: number;
      toIndex: number;
    };

interface PlaylistOrderSnapshot {
  items: PlaylistPageItem[];
  complete: boolean;
  reason: "request_budget" | "quota" | "page_limit" | null;
}

export interface PlaylistSyncBatchResult {
  processed: number;
  skipped: number;
  failed: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
  quota_stopped: boolean;
  quota_stop_reason: string | null;
  /** outbox に運営通知を作成したため、commit後にwakeを送る必要がある件数。 */
  notification_wake_count: number;
}

export type PlaylistSyncRunStatus =
  | "succeeded"
  | "failed"
  | "deferred"
  | "skipped";

export type PlaylistSyncRunOutcome = {
  status: PlaylistSyncRunStatus;
  detailCode: string | null;
};

export type PlaylistSyncIncidentTransition =
  | {
      action: "open";
      severity: "warning" | "critical";
      fingerprint: string;
    }
  | { action: "resolve" }
  | { action: "none" };

const MAX_EVENTS_PER_RUN = 1;
const MAX_SCAN_PAGES_PER_EVENT = 3;
const MAX_ORDER_SCAN_PAGES_PER_EVENT = 8;
const MAX_MUTATIONS_PER_RUN = 4;
const MAX_ORDER_REPAIRS_PER_RUN = 2;
const MAX_SOURCE_VIDEOS = 5000;
export const PLAYLIST_MAX_REMOTE_ITEMS = 5000;
export const PLAYLIST_STALE_DELETE_BATCH_SIZE = 100;
/** D1の1 statement 100 bind上限へ余白を残す。実際は共通5 + 2/item。 */
export const PLAYLIST_SCAN_UPSERT_CHUNK_SIZE = 14;
const STALE_CLEANUP_CURSOR = "__flamenode_stale_cleanup__";
const FULL_SCAN_INTERVAL_SEC = 24 * 60 * 60;
const RETRY_DELAY_SEC = 60 * 60;
const FAILURE_RETRY_SEC = 6 * 60 * 60;
const API_TIMEOUT_MS = 10_000;
/** OAuth / scan / bounded order check / mutationを同一invocationで12 subrequest以内に閉じる。 */
const MAX_EXTERNAL_REQUESTS_PER_RUN = 12;
const OAUTH_TOKEN_SAFETY_MS = 60_000;
const PLAYLIST_RUN_LEASE_SEC = 15 * 60;
const PLAYLIST_MUTATION_LEASE_SAFETY_SEC =
  Math.ceil(API_TIMEOUT_MS / 1_000) + 5;
const HISTORY_DETAIL_CODE_MAX_LENGTH = 160;

class QuotaDeferredError extends Error {
  constructor() {
    super("youtube_playlist_quota_deferred");
    this.name = "QuotaDeferredError";
  }
}

class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string) {
    super(`youtube_api_${status}_${reason}`);
    this.name = "YouTubeApiError";
    this.status = status;
    this.reason = reason;
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizedRunId(value: string | undefined): string {
  const runId = value?.trim();
  return runId && runId.length <= 128 ? runId : crypto.randomUUID();
}

function normalizedDispatchSource(value: string | undefined): string {
  const source = value?.trim();
  return source ? source.slice(0, 80) : "direct";
}

function boundedDetailCode(value: string | null): string | null {
  const detail = value?.trim();
  return detail ? detail.slice(0, HISTORY_DETAIL_CODE_MAX_LENGTH) : null;
}

function safeNotificationText(value: string | null | undefined, max = 180): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b")
    .replace(/[<>`]/g, "")
    .trim()
    .slice(0, max);
}

export function derivePlaylistIncidentTransition(
  outcome: PlaylistSyncRunOutcome,
): PlaylistSyncIncidentTransition {
  const detail = boundedDetailCode(outcome.detailCode) ?? "none";
  if (outcome.status === "failed") {
    return {
      action: "open",
      severity: "critical",
      fingerprint: `youtube_playlist_sync:failed:${detail}`,
    };
  }
  if (outcome.status === "deferred") {
    return {
      action: "open",
      severity: "warning",
      fingerprint: `youtube_playlist_sync:deferred:${detail}`,
    };
  }
  if (outcome.status === "succeeded") return { action: "resolve" };
  return { action: "none" };
}

class DailyQuotaBudget {
  private readonly env: PlaylistSyncEnv;
  private readonly now: number;
  private readonly signal?: AbortSignal;
  private remainingUnits: number;
  private changedRows = 0;

  private constructor(
    env: PlaylistSyncEnv,
    now: number,
    remainingUnits: number,
    signal?: AbortSignal,
  ) {
    this.env = env;
    this.now = now;
    this.remainingUnits = remainingUnits;
    this.signal = signal;
  }

  static async load(
    env: PlaylistSyncEnv,
    now: number,
    signal?: AbortSignal,
  ): Promise<DailyQuotaBudget> {
    signal?.throwIfAborted();
    const snapshot = await loadYoutubeQuotaSnapshot(env, now, signal);
    return new DailyQuotaBudget(env, now, snapshot.remainingUnits, signal);
  }

  canSpend(cost: number): boolean {
    return cost > 0 && cost <= this.remainingUnits;
  }

  get d1Changes(): number {
    return this.changedRows;
  }

  async spend(cost: number): Promise<void> {
    this.signal?.throwIfAborted();
    if (!this.canSpend(cost)) throw new QuotaDeferredError();
    const reservation = await reserveYoutubeQuota(
      this.env,
      cost,
      this.now,
      this.signal,
    );
    if (!reservation) {
      this.remainingUnits = 0;
      throw new QuotaDeferredError();
    }
    this.changedRows += reservation.d1Changes;
    this.remainingUnits = Math.max(
      0,
      reservation.dailyBudgetUnits - reservation.usedUnits,
    );
  }
}

async function readApiError(
  response: Response,
  signal?: AbortSignal,
): Promise<YouTubeApiError> {
  signal?.throwIfAborted();
  let reason = "request_failed";
  try {
    const body = (await response.json()) as unknown;
    reason = parseYoutubeApiErrorReason(body);
    signal?.throwIfAborted();
  } catch {
    signal?.throwIfAborted();
    await cancelResponseBody(response);
    // API本文をログやDBへ保存しない。
  }
  return new YouTubeApiError(response.status, reason.slice(0, 80));
}

type CachedAccessToken = { value: string; expiresAt: number };
const tokenState = globalThis as typeof globalThis & {
  __flamenodeYoutubePlaylistAccessToken?: CachedAccessToken;
};

function clearCachedAccessToken(): void {
  delete tokenState.__flamenodeYoutubePlaylistAccessToken;
}

async function refreshAccessToken(
  env: PlaylistSyncEnv,
  requestBudget: ExternalRequestBudget,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  signal?.throwIfAborted();
  const now = Date.now();
  const cached = tokenState.__flamenodeYoutubePlaylistAccessToken;
  if (cached && cached.expiresAt - now > OAUTH_TOKEN_SAFETY_MS) {
    return cached.value;
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: trimmedSecret(env.YOUTUBE_OAUTH_CLIENT_ID),
          client_secret: trimmedSecret(env.YOUTUBE_OAUTH_CLIENT_SECRET),
          refresh_token: trimmedSecret(env.YOUTUBE_OAUTH_REFRESH_TOKEN),
          grant_type: "refresh_token",
        }),
        signal,
      },
      {
        timeoutMs: API_TIMEOUT_MS,
        budget: requestBudget,
        budgetErrorCode: "youtube_playlist_request_budget_exhausted",
        timeoutErrorCode: "youtube_oauth_timeout",
        networkErrorCode: "youtube_oauth_network_error",
      },
      fetchImpl,
    );
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  if (!response.ok) throw await readApiError(response, signal);
  let body: { access_token?: unknown; expires_in?: unknown };
  try {
    body = (await response.json()) as typeof body;
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("youtube_oauth_access_token_missing");
  }
  const expiresIn = Number(body.expires_in);
  tokenState.__flamenodeYoutubePlaylistAccessToken = {
    value: body.access_token,
    expiresAt:
      now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
  return body.access_token;
}

async function youtubeJson<T>(
  url: URL,
  init: RequestInit,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  cost: number,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  signal?.throwIfAborted();
  // fetch budgetを使い切っている場合、YouTubeへ到達しないrequestのquotaをD1へ
  // 先に予約しない。network開始後の失敗は到達有無を判定できないため返却しない。
  if (requestBudget.remaining <= 0) {
    throw new Error("youtube_playlist_request_budget_exhausted");
  }
  await quota.spend(cost);
  signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      { ...init, headers, signal },
      {
        timeoutMs: API_TIMEOUT_MS,
        budget: requestBudget,
        budgetErrorCode: "youtube_playlist_request_budget_exhausted",
        timeoutErrorCode: "youtube_playlist_api_timeout",
        networkErrorCode: "youtube_playlist_api_network_error",
      },
      fetchImpl,
    );
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  if (!response.ok) {
    const error = await readApiError(response, signal);
    if (response.status === 401) clearCachedAccessToken();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  try {
    const body = (await response.json()) as T;
    signal?.throwIfAborted();
    return body;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}

const YOUTUBE_QUOTA_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "dailyLimitExceededUnreg",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

const SAFE_YOUTUBE_API_REASON = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function normalizeYoutubeApiReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  return SAFE_YOUTUBE_API_REASON.test(reason) ? reason : "request_failed";
}

/** API本文からログへ保存してよい短いreasonだけを取り出す。 */
export function parseYoutubeApiErrorReason(body: unknown): string {
  if (!body || typeof body !== "object") return "request_failed";
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return "request_failed";

  const errors = (error as Record<string, unknown>).errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  const reason = first && typeof first === "object"
    ? (first as Record<string, unknown>).reason
    : undefined;
  if (typeof reason === "string" && reason.trim()) {
    return normalizeYoutubeApiReason(reason);
  }

  const status = (error as Record<string, unknown>).status;
  if (typeof status === "string" && status.trim()) {
    return normalizeYoutubeApiReason(status.toLowerCase());
  }
  return "request_failed";
}

async function listPlaylistPage(
  playlistId: string,
  pageToken: string | null,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<PlaylistPage> {
  signal?.throwIfAborted();
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", "50");
  url.searchParams.set(
    "fields",
    "nextPageToken,items(id,snippet/resourceId/videoId)",
  );
  url.searchParams.set("prettyPrint", "false");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const body = await youtubeJson<{
    nextPageToken?: string;
    items?: Array<{
      id?: string;
      snippet?: { resourceId?: { videoId?: string } };
    }>;
  }>(
    url,
    { method: "GET" },
    accessToken,
    quota,
    requestBudget,
    1,
    signal,
    fetchImpl,
  );

  const items = (body.items ?? []).flatMap((item) => {
    const playlistItemId = item.id?.trim();
    const videoId = item.snippet?.resourceId?.videoId?.trim();
    return playlistItemId && videoId ? [{ playlistItemId, videoId }] : [];
  });
  return {
    items,
    nextPageToken: body.nextPageToken?.trim() || null,
  };
}

async function postPlaylistItem(
  playlistId: string,
  videoId: string,
  position: number | null,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  signal?.throwIfAborted();
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("fields", "id");
  url.searchParams.set("prettyPrint", "false");
  const snippet: Record<string, unknown> = {
    playlistId,
    resourceId: { kind: "youtube#video", videoId },
  };
  if (position != null) snippet.position = position;

  const body = await youtubeJson<{ id?: string }>(
    url,
    {
      method: "POST",
      body: JSON.stringify({ snippet }),
    },
    accessToken,
    quota,
    requestBudget,
    50,
    signal,
    fetchImpl,
  );
  if (!body.id) throw new Error("youtube_playlist_item_id_missing");
  return body.id;
}

async function insertPlaylistItem(
  playlistId: string,
  videoId: string,
  position: number,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<InsertedPlaylistItem> {
  signal?.throwIfAborted();
  try {
    return {
      id: await postPlaylistItem(
        playlistId,
        videoId,
        position,
        accessToken,
        quota,
        requestBudget,
        signal,
        fetchImpl,
      ),
      ordered: true,
    };
  } catch (error) {
    signal?.throwIfAborted();
    const canFallback =
      error instanceof YouTubeApiError &&
      (error.reason === "manualSortRequired" ||
        error.reason === "invalidPlaylistItemPosition");
    if (!canFallback) throw error;

    return {
      id: await postPlaylistItem(
        playlistId,
        videoId,
        null,
        accessToken,
        quota,
        requestBudget,
        signal,
        fetchImpl,
      ),
      ordered: false,
    };
  }
}

async function updatePlaylistItemPosition(
  playlistId: string,
  item: PlaylistPageItem,
  position: number,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  signal?.throwIfAborted();
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("fields", "id");
  url.searchParams.set("prettyPrint", "false");
  try {
    await youtubeJson<{ id?: string }>(
      url,
      {
        method: "PUT",
        body: JSON.stringify({
          id: item.playlistItemId,
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId: item.videoId },
            position: Math.max(0, position),
          },
        }),
      },
      accessToken,
      quota,
      requestBudget,
      50,
      signal,
      fetchImpl,
    );
    return true;
  } catch (error) {
    signal?.throwIfAborted();
    if (
      error instanceof YouTubeApiError &&
      (error.reason === "manualSortRequired" ||
        error.reason === "invalidPlaylistItemPosition")
    ) {
      return false;
    }
    throw error;
  }
}

async function deletePlaylistItem(
  playlistItemId: string,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  signal?.throwIfAborted();
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("id", playlistItemId);
  url.searchParams.set("prettyPrint", "false");
  try {
    await youtubeJson<void>(
      url,
      { method: "DELETE" },
      accessToken,
      quota,
      requestBudget,
      50,
      signal,
      fetchImpl,
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof YouTubeApiError && error.status === 404) return;
    throw error;
  }
}

async function loadPlaylistOrderSnapshot(
  playlistId: string,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<PlaylistOrderSnapshot> {
  const items: PlaylistPageItem[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | null = null;

  for (let page = 0; page < MAX_ORDER_SCAN_PAGES_PER_EVENT; page += 1) {
    signal?.throwIfAborted();
    // 次のGET(1 unit/subrequest)と最低1回のposition更新(50 units/subrequest)を残す。
    if (requestBudget.remaining <= 1) {
      return { items, complete: false, reason: "request_budget" };
    }
    if (!quota.canSpend(51)) {
      return { items, complete: false, reason: "quota" };
    }
    const result = await listPlaylistPage(
      playlistId,
      pageToken,
      accessToken,
      quota,
      requestBudget,
      signal,
      fetchImpl,
    );
    items.push(...result.items);
    if (!result.nextPageToken) {
      return { items, complete: true, reason: null };
    }
    if (seenTokens.has(result.nextPageToken)) {
      throw new Error("youtube_playlist_order_scan_token_cycle");
    }
    seenTokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }

  return { items, complete: false, reason: "page_limit" };
}

export function planPlaylistOrderRepair(
  sourceVideoIds: readonly string[],
  remoteItems: readonly PlaylistPageItem[],
): PlaylistOrderRepairPlan {
  if (sourceVideoIds.length === 0) return { status: "aligned" };
  const desiredSet = new Set(sourceVideoIds);
  if (desiredSet.size !== sourceVideoIds.length) return { status: "ambiguous" };

  const relevant = remoteItems.flatMap((item, absoluteIndex) =>
    desiredSet.has(item.videoId) ? [{ item, absoluteIndex }] : [],
  );
  if (relevant.length !== sourceVideoIds.length) return { status: "ambiguous" };

  const occurrences = new Map<string, number>();
  for (const entry of relevant) {
    occurrences.set(entry.item.videoId, (occurrences.get(entry.item.videoId) ?? 0) + 1);
  }
  if (sourceVideoIds.some((videoId) => occurrences.get(videoId) !== 1)) {
    return { status: "ambiguous" };
  }

  for (let index = 0; index < sourceVideoIds.length; index += 1) {
    const expectedVideoId = sourceVideoIds[index];
    const atIndex = relevant[index];
    if (atIndex?.item.videoId === expectedVideoId) continue;
    const expected = relevant.find(
      (entry, candidateIndex) =>
        candidateIndex > index && entry.item.videoId === expectedVideoId,
    );
    if (!expected || !atIndex || expected.absoluteIndex <= atIndex.absoluteIndex) {
      return { status: "ambiguous" };
    }
    return {
      status: "move",
      playlistItemId: expected.item.playlistItemId,
      videoId: expected.item.videoId,
      fromIndex: expected.absoluteIndex,
      toIndex: atIndex.absoluteIndex,
    };
  }
  return { status: "aligned" };
}

function applyLocalOrderMove(
  items: PlaylistPageItem[],
  fromIndex: number,
  toIndex: number,
): void {
  if (fromIndex <= toIndex || fromIndex >= items.length || toIndex < 0) return;
  const [moved] = items.splice(fromIndex, 1);
  if (moved) items.splice(toIndex, 0, moved);
}

async function loadDueConfigs(
  env: PlaylistSyncEnv,
  now: number,
  signal?: AbortSignal,
): Promise<SyncConfigRow[]> {
  signal?.throwIfAborted();
  const result = await env.DB.prepare(
    `SELECT event_id, playlist_id, sync_mode, sync_interval_minutes,
            sync_status, next_sync_at, last_synced_at, last_full_scan_at,
            scan_started_at, scan_page_token, last_error, pending_trigger
     FROM event_youtube_playlist_sync
     WHERE enabled = 1
       AND playlist_id IS NOT NULL
       AND playlist_id <> ''
       AND sync_mode IN ('append_only', 'mirror')
       AND COALESCE(next_sync_at, 0) <= ?1
       AND (
         run_lease_token IS NULL
         OR run_lease_expires_at IS NULL
         OR run_lease_expires_at <= ?1
       )
     ORDER BY CASE WHEN scan_started_at IS NULL THEN 1 ELSE 0 END,
              COALESCE(next_sync_at, 0), event_id
     LIMIT ?2`,
  )
    .bind(now, MAX_EVENTS_PER_RUN)
    .all<SyncConfigRow>();
  signal?.throwIfAborted();
  return result.results ?? [];
}

const CONTINUATION_DETAIL_CODES = new Set([
  "playlist_scan_continuing",
  "playlist_stale_cleanup_continuing",
  "playlist_mutation_batch_continuing",
  "playlist_order_repair_continuing",
  "playlist_order_repair_request_budget",
]);

function nextPendingTrigger(
  outcome: PlaylistSyncRunOutcome,
): PlaylistSyncTrigger | null {
  return outcome.status === "deferred" &&
      outcome.detailCode != null &&
      CONTINUATION_DETAIL_CODES.has(outcome.detailCode)
    ? "continuation"
    : null;
}

export async function claimPlaylistSyncConfig(
  env: PlaylistSyncEnv,
  config: SyncConfigRow,
  context: PlaylistSyncRunContext,
  now: number,
  startedMs = Date.now(),
): Promise<ClaimedSyncConfig | null> {
  const runId = normalizedRunId(context.runId);
  const fallbackTrigger = context.trigger;
  const leaseExpiresAt = now + PLAYLIST_RUN_LEASE_SEC;
  const results = await env.DB.batch([
    env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
        SET run_lease_token = ?1,
            run_lease_expires_at = ?2,
            last_attempt_at = ?3,
            last_run_id = ?1,
            pending_trigger = COALESCE(pending_trigger, ?4),
            updated_at = ?3
      WHERE event_id = ?5
        AND playlist_id = ?6
        AND enabled = 1
        AND sync_mode = ?7
        AND COALESCE(next_sync_at, 0) <= ?3
        AND (
          run_lease_token IS NULL
          OR run_lease_expires_at IS NULL
          OR run_lease_expires_at <= ?3
        )
      RETURNING pending_trigger`,
    ).bind(
      runId,
      leaseExpiresAt,
      now,
      fallbackTrigger,
      config.event_id,
      config.playlist_id,
      config.sync_mode,
    ),
    // A lease takeover is the recovery boundary for a crashed/aborted run.
    // Close any history row that can no longer finish under the old lease so
    // retention and observability do not retain an eternal `running` row.
    env.DB.prepare(
      `UPDATE event_youtube_playlist_sync_runs
          SET status = 'skipped', finished_at = ?1,
              duration_ms = MAX(0, (?1 - started_at) * 1000),
              detail_code = 'lease_expired'
        WHERE event_id = ?2
          AND playlist_id = ?3
          AND status = 'running'
          AND EXISTS (
            SELECT 1 FROM event_youtube_playlist_sync
             WHERE event_id = ?2
               AND playlist_id = ?3
               AND run_lease_token = ?4
               AND run_lease_expires_at = ?5
          )`,
    ).bind(
      now,
      config.event_id,
      config.playlist_id,
      runId,
      leaseExpiresAt,
    ),
  ]);
  const claim = results[0] as D1Result<{ pending_trigger: PlaylistSyncTrigger }>;
  const changes = Number(claim.meta?.changes ?? 0);
  const row = claim.results?.[0];
  if (changes === 0 && !row) return null;
  if (changes !== 1 || !row) {
    throw new Error("youtube_playlist_run_claim_inconsistent");
  }
  return {
    ...config,
    pending_trigger: row.pending_trigger,
    run_id: runId,
    run_lease_expires_at: leaseExpiresAt,
    claimed_trigger: row.pending_trigger,
    dispatch_source: normalizedDispatchSource(context.dispatchSource),
    run_started_ms: startedMs,
  };
}

/**
 * Finish a run that was interrupted after its history row was created.
 * This deliberately ignores the caller's AbortSignal and uses only the
 * run_id/lease identity, so a deadline cannot strand a lease or history row.
 */
export async function abortPlaylistSyncRun(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  now: number,
  detailCode = "aborted",
): Promise<void> {
  const durationMs = Math.max(0, Date.now() - config.run_started_ms);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE event_youtube_playlist_sync_runs
          SET status = 'skipped', finished_at = ?1, duration_ms = ?2,
              detail_code = ?3
        WHERE run_id = ?4 AND status = 'running'`,
    ).bind(now, durationMs, boundedDetailCode(detailCode), config.run_id),
    env.DB.prepare(
      `UPDATE event_youtube_playlist_sync
          SET sync_status = 'failed', next_sync_at = ?1,
              last_error = ?2, last_duration_ms = ?3,
              run_lease_token = NULL, run_lease_expires_at = NULL,
              updated_at = MAX(updated_at, ?1)
        WHERE event_id = ?4 AND playlist_id = ?5
          AND run_lease_token = ?6
          AND run_lease_expires_at = ?7`,
    ).bind(
      now + FAILURE_RETRY_SEC,
      boundedDetailCode(detailCode),
      durationMs,
      config.event_id,
      config.playlist_id,
      config.run_id,
      config.run_lease_expires_at,
    ),
  ]);
}

export async function beginPlaylistSyncRun(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  now: number,
): Promise<void> {
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE event_youtube_playlist_sync
          SET pending_trigger = NULL
        WHERE event_id = ?1
          AND playlist_id = ?2
          AND enabled = 1
          AND sync_mode = ?3
          AND run_lease_token = ?4
          AND run_lease_expires_at = ?5
          AND run_lease_expires_at > ?6
          AND pending_trigger = ?7`,
    ).bind(
      config.event_id,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
      now,
      config.claimed_trigger,
    ),
    env.DB.prepare(
      `INSERT INTO event_youtube_playlist_sync_runs (
         run_id, event_id, playlist_id, trigger, dispatch_source,
         status, started_at, created_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5, 'running', ?6, ?6
       WHERE EXISTS (
         SELECT 1 FROM event_youtube_playlist_sync
          WHERE event_id = ?2 AND playlist_id = ?3
            AND enabled = 1 AND sync_mode = ?8
            AND run_lease_token = ?1
            AND run_lease_expires_at = ?7
            AND run_lease_expires_at > ?6
            AND pending_trigger IS NULL
       )`,
    ).bind(
      config.run_id,
      config.event_id,
      config.playlist_id,
      config.claimed_trigger,
      config.dispatch_source,
      now,
      config.run_lease_expires_at,
      config.sync_mode,
    ),
  ]);
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1 ||
    Number(results[1]?.meta?.changes ?? 0) !== 1
  ) {
    throw new Error("youtube_playlist_run_start_failed");
  }
}

function buildIncidentStatement(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  outcome: PlaylistSyncRunOutcome,
  now: number,
): D1PreparedStatement | null {
  const transition = derivePlaylistIncidentTransition(outcome);
  const incidentKey = `youtube_playlist_sync:${config.event_id}`;
  if (transition.action === "none") return null;
  if (transition.action === "resolve") {
    return env.DB.prepare(
      `UPDATE ops_incident_state
           SET state = 'resolved', last_seen_at = ?1,
               last_correlation_id = ?2, resolved_at = ?1,
               last_notified_at = ?1
        WHERE incident_key = ?3 AND state = 'open'
          AND EXISTS (
            SELECT 1 FROM event_youtube_playlist_sync
             WHERE event_id = ?4 AND playlist_id = ?5
               AND enabled = 1 AND sync_mode = ?7
               AND run_lease_token = ?2
               AND run_lease_expires_at = ?6
               AND run_lease_expires_at > ?1
          )`,
    ).bind(
      now,
      config.run_id,
      incidentKey,
      config.event_id,
      config.playlist_id,
      config.run_lease_expires_at,
      config.sync_mode,
    );
  }
  return env.DB.prepare(
    `INSERT INTO ops_incident_state (
       incident_key, state, severity, fingerprint, opened_at, last_seen_at,
       occurrence_count, last_notified_at, last_correlation_id, resolved_at
     )
      SELECT ?1, 'open', ?2, ?3, ?4, ?4, 1, ?10, ?5, NULL
     WHERE EXISTS (
       SELECT 1 FROM event_youtube_playlist_sync
       WHERE event_id = ?6 AND playlist_id = ?7
          AND enabled = 1 AND sync_mode = ?9
          AND run_lease_token = ?5
          AND run_lease_expires_at = ?8
          AND run_lease_expires_at > ?4
     )
     ON CONFLICT(incident_key) DO UPDATE SET
       state = 'open',
       severity = excluded.severity,
       fingerprint = excluded.fingerprint,
       opened_at = CASE
         WHEN ops_incident_state.state = 'resolved'
           OR ops_incident_state.fingerprint <> excluded.fingerprint
         THEN excluded.opened_at ELSE ops_incident_state.opened_at END,
       last_seen_at = excluded.last_seen_at,
       occurrence_count = CASE
         WHEN ops_incident_state.state = 'resolved'
           OR ops_incident_state.fingerprint <> excluded.fingerprint
         THEN 1 ELSE ops_incident_state.occurrence_count + 1 END,
        last_notified_at = CASE
          WHEN ops_incident_state.state = 'resolved'
            OR ops_incident_state.fingerprint <> excluded.fingerprint
          THEN ?10 ELSE ops_incident_state.last_notified_at END,
       last_correlation_id = excluded.last_correlation_id,
       resolved_at = NULL`,
  ).bind(
    incidentKey,
    transition.severity,
    transition.fingerprint,
    now,
    config.run_id,
    config.event_id,
    config.playlist_id,
    config.run_lease_expires_at,
    config.sync_mode,
    now,
  );
}

/**
 * Incident state と同じ finish batch に入れる運営 Forum 通知。
 * D1 が正本で、Queue は commit 後の doorbell に過ぎない。INSERT OR IGNORE と
 * transition 条件で、同じ run の再配送や同一 fingerprint の継続失敗を抑止する。
 */
function buildIncidentNotificationStatement(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  outcome: PlaylistSyncRunOutcome,
  now: number,
): D1PreparedStatement | null {
  const transition = derivePlaylistIncidentTransition(outcome);
  if (transition.action === "none") return null;
  const incidentKey = `youtube_playlist_sync:${config.event_id}`;
  const isResolve = transition.action === "resolve";
  const notificationType = isResolve
    ? "ops_youtube_playlist_sync_recovered"
    : outcome.status === "deferred"
      ? "ops_youtube_quota_deferred"
      : "ops_youtube_playlist_sync_failed";
  const fingerprint = isResolve ? "resolved" : transition.fingerprint;
  const dedupeKey = `${incidentKey}:${transition.action}:${fingerprint}:${config.run_id}`.slice(
    0,
    240,
  );
  const eventText = safeNotificationText(config.event_id, 96);
  const detailText = safeNotificationText(outcome.detailCode, 160) || "none";
  const statusText = safeNotificationText(outcome.status, 32);
  const runText = safeNotificationText(config.run_id, 128);
  const payload = JSON.stringify({
    content: [
      `[YouTube playlist] ${isResolve ? "recovered" : statusText}`,
      `event_id: ${eventText}`,
      `detail: ${detailText}`,
      `run_id: ${runText}`,
    ].join("\n"),
    allowed_mentions: { parse: [] },
    webhook_target: "system",
    thread_name: `youtube-playlist:${eventText}`.slice(0, 100),
    event_id: config.event_id,
  });
  const transitionPredicate = isResolve
    ? `EXISTS (
         SELECT 1 FROM ops_incident_state
          WHERE incident_key = ?8 AND state = 'open'
       )`
    : `NOT EXISTS (
         SELECT 1 FROM ops_incident_state
          WHERE incident_key = ?8 AND state = 'open' AND fingerprint = ?9
       )`;
  return env.DB.prepare(
    `INSERT OR IGNORE INTO notification_outbox (
       id, recipient_user_id, type, payload_json, delivery_route,
       correlation_id, status, attempt_count, processing_started_at,
       lease_token, lease_expires_at, next_attempt_at, last_error,
       processed_at, event_id, dedupe_key, created_at
     )
     SELECT ?1, NULL, ?2, ?3, 'channel', ?4, 'pending', 0, NULL,
            NULL, NULL, ?5, NULL, NULL, ?6, ?7, ?5
      WHERE ${transitionPredicate}
       AND EXISTS (
         SELECT 1 FROM event_youtube_playlist_sync
          WHERE event_id = ?10 AND playlist_id = ?11
            AND enabled = 1 AND sync_mode = ?12
            AND run_lease_token = ?14
            AND run_lease_expires_at = ?13
            AND run_lease_expires_at > ?5
       )`,
  ).bind(
    crypto.randomUUID(),
    notificationType,
    payload,
    config.run_id,
    now,
    config.event_id,
    dedupeKey,
    incidentKey,
    fingerprint,
    config.event_id,
    config.playlist_id,
    config.sync_mode,
    config.run_lease_expires_at,
    config.run_id,
  );
}

export async function finishPlaylistSyncRun(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  outcome: PlaylistSyncRunOutcome,
  now: number,
): Promise<boolean> {
  const durationMs = Math.max(0, Date.now() - config.run_started_ms);
  const pendingTrigger = nextPendingTrigger(outcome);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE event_youtube_playlist_sync_runs
          SET status = ?1, finished_at = ?2, duration_ms = ?3,
              detail_code = ?4
        WHERE run_id = ?5 AND status = 'running'
          AND EXISTS (
            SELECT 1 FROM event_youtube_playlist_sync
             WHERE event_id = ?6 AND playlist_id = ?7
               AND enabled = 1 AND sync_mode = ?9
               AND run_lease_token = ?5
               AND run_lease_expires_at = ?8
               AND run_lease_expires_at > ?2
          )`,
    ).bind(
      outcome.status,
      now,
      durationMs,
      boundedDetailCode(outcome.detailCode),
      config.run_id,
      config.event_id,
      config.playlist_id,
      config.run_lease_expires_at,
      config.sync_mode,
    ),
  ];
  const notificationStatement = buildIncidentNotificationStatement(
    env,
    config,
    outcome,
    now,
  );
  if (notificationStatement) statements.push(notificationStatement);
  const incidentStatement = buildIncidentStatement(env, config, outcome, now);
  if (incidentStatement) statements.push(incidentStatement);
  statements.push(
    env.DB.prepare(
      `UPDATE event_youtube_playlist_sync
          SET last_duration_ms = ?1,
              pending_trigger = CASE
                WHEN pending_trigger IS NOT NULL THEN pending_trigger ELSE ?2 END,
              next_sync_at = CASE
                WHEN pending_trigger IS NOT NULL OR ?2 IS NOT NULL
                THEN MIN(COALESCE(next_sync_at, ?3), ?3)
                ELSE next_sync_at END,
              run_lease_token = NULL,
              run_lease_expires_at = NULL,
              updated_at = MAX(updated_at, ?3)
        WHERE event_id = ?4
          AND playlist_id = ?5
          AND enabled = 1
          AND sync_mode = ?8
          AND run_lease_token = ?6
          AND run_lease_expires_at = ?7
          AND run_lease_expires_at > ?3`,
    ).bind(
      durationMs,
      pendingTrigger,
      now,
      config.event_id,
      config.playlist_id,
      config.run_id,
      config.run_lease_expires_at,
      config.sync_mode,
    ),
  );
  const results = await env.DB.batch(statements);
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1 ||
    (incidentStatement &&
      derivePlaylistIncidentTransition(outcome).action === "open" &&
      Number(results[notificationStatement ? 2 : 1]?.meta?.changes ?? 0) !== 1) ||
    Number(results[(notificationStatement ? 1 : 0) + (incidentStatement ? 2 : 1)]?.meta?.changes ?? 0) !== 1
  ) {
    throw new Error("youtube_playlist_run_finish_failed");
  }
  return Boolean(
    notificationStatement &&
      Number(results[1]?.meta?.changes ?? 0) === 1,
  );
}

async function loadSourceVideoIds(
  env: PlaylistSyncEnv,
  eventId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  const result = await env.DB.prepare(
    `WITH event_videos AS (
       SELECT video_id
       FROM video_events
       WHERE event_id = ?1
       UNION
       SELECT id AS video_id
       FROM videos
       WHERE primary_event_id = ?1
     )
     SELECT v.youtube_video_id
     FROM event_videos ev
     INNER JOIN videos v ON v.id = ev.video_id
     LEFT JOIN slots s
       ON s.event_id = ?1
      AND s.video_id = v.id
      AND s.status = 'submitted'
     WHERE v.youtube_video_id IS NOT NULL
       AND v.youtube_video_id <> ''
       AND v.visibility_status = 'public'
     GROUP BY v.youtube_video_id
     ORDER BY
       CASE WHEN COUNT(s.id) > 0 THEN 0 ELSE 1 END,
       MIN(CASE WHEN s.start_time IS NULL THEN 9223372036854775807 ELSE s.start_time END),
       MIN(CASE WHEN s.sort_order IS NULL THEN 2147483647 ELSE s.sort_order END),
       MIN(COALESCE(v.scheduled_time, v.created_at)),
       MIN(v.id)
     LIMIT ?2`,
  )
    .bind(eventId, MAX_SOURCE_VIDEOS + 1)
    .all<{ youtube_video_id: string }>();
  signal?.throwIfAborted();
  const rows = result.results ?? [];
  if (rows.length > MAX_SOURCE_VIDEOS) {
    throw new Error("youtube_playlist_source_limit_exceeded");
  }
  return rows.map((row) => row.youtube_video_id);
}

async function loadRemoteItems(
  env: PlaylistSyncEnv,
  eventId: string,
  signal?: AbortSignal,
): Promise<RemoteItemRow[]> {
  signal?.throwIfAborted();
  const result = await env.DB.prepare(
    `SELECT playlist_item_id, youtube_video_id
     FROM event_youtube_playlist_items
     WHERE event_id = ?1
     ORDER BY created_at, playlist_item_id
     LIMIT ?2`,
  )
    .bind(eventId, PLAYLIST_MAX_REMOTE_ITEMS + 1)
    .all<RemoteItemRow>();
  signal?.throwIfAborted();
  const rows = result.results ?? [];
  if (rows.length > PLAYLIST_MAX_REMOTE_ITEMS) {
    throw new Error("youtube_playlist_remote_limit_exceeded");
  }
  return rows;
}

export async function upsertScannedItems(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  items: PlaylistPageItem[],
  seenAt: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const statements: D1PreparedStatement[] = [];
  for (
    let offset = 0;
    offset < items.length;
    offset += PLAYLIST_SCAN_UPSERT_CHUNK_SIZE
  ) {
    signal?.throwIfAborted();
    const chunk = items.slice(offset, offset + PLAYLIST_SCAN_UPSERT_CHUNK_SIZE);
    // Guard every scan write by the playlist identity. An in-flight worker
    // must not attach the old playlist's remote items after an admin changes
    // the event configuration.
    const selects = chunk
      .map((_, index) => {
        const itemParam = 8 + index * 2;
        return `SELECT ?1, ?${itemParam}, ?${itemParam + 1}, ?2, 0, ?2
          WHERE EXISTS (
            SELECT 1 FROM event_youtube_playlist_sync
             WHERE event_id = ?1 AND playlist_id = ?3
               AND enabled = 1 AND sync_mode = ?4
               AND run_lease_token = ?5
               AND run_lease_expires_at = ?6
               AND run_lease_expires_at > ?7
               AND (pending_trigger IS NULL OR pending_trigger = 'continuation')
          )`;
      })
      .join(" UNION ALL ");
    const values = [
      seenAt,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
      unixNow(),
      ...chunk.flatMap((item) => [item.playlistItemId, item.videoId]),
    ];
    values.unshift(config.event_id);
    if (values.length > 100) {
      throw new Error("youtube_playlist_scan_bind_budget_exceeded");
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO event_youtube_playlist_items (
           event_id, playlist_item_id, youtube_video_id, seen_at,
           managed_by_flamenode, created_at
         ) ${selects}
         ON CONFLICT(event_id, playlist_item_id) DO UPDATE SET
           youtube_video_id = excluded.youtube_video_id,
           seen_at = excluded.seen_at`,
      ).bind(...values),
    );
  }
  signal?.throwIfAborted();
  if (statements.length > 0) {
    const results = await env.DB.batch(statements);
    const changed = results.reduce(
      (sum, result) => sum + Math.max(0, Number(result?.meta?.changes ?? 0)),
      0,
    );
    if (changed < items.length) {
      throw new Error("youtube_playlist_config_changed");
    }
    signal?.throwIfAborted();
  }
}

async function markScanStarted(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  scanStartedAt: number,
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = 'scanning', scan_started_at = ?1,
          scan_page_token = NULL, last_error = NULL, updated_at = ?2
     WHERE event_id = ?3 AND playlist_id = ?4
       AND enabled = 1 AND sync_mode = ?5
       AND run_lease_token = ?6
       AND run_lease_expires_at = ?7
       AND run_lease_expires_at > ?2
       AND (pending_trigger IS NULL OR pending_trigger = 'continuation')`,
  )
    .bind(
      scanStartedAt,
      now,
      config.event_id,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
    )
    .run()
    .then((result) => {
      if (Number(result.meta?.changes ?? 0) !== 1) {
        throw new Error("youtube_playlist_config_changed");
      }
      return result;
    });
  signal?.throwIfAborted();
}

export async function cleanupStaleScanItems(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  scanStartedAt: number,
  now: number,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  const result = await env.DB.prepare(
    `DELETE FROM event_youtube_playlist_items
     WHERE event_id = ?1
       AND EXISTS (
         SELECT 1 FROM event_youtube_playlist_sync
          WHERE event_id = ?1 AND playlist_id = ?4 AND enabled = 1
            AND sync_mode = ?5 AND run_lease_token = ?6
            AND run_lease_expires_at = ?7
            AND run_lease_expires_at > ?8
            AND (pending_trigger IS NULL OR pending_trigger = 'continuation')
       )
       AND playlist_item_id IN (
         SELECT playlist_item_id
         FROM event_youtube_playlist_items
         WHERE event_id = ?1 AND seen_at <> ?2
         ORDER BY created_at ASC, playlist_item_id ASC
         LIMIT ?3
       )`,
  )
    .bind(
      config.event_id,
      scanStartedAt,
      PLAYLIST_STALE_DELETE_BATCH_SIZE,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
      unixNow(),
    )
    .run();
  signal?.throwIfAborted();
  const deleted = Number(result.meta?.changes);
  if (!Number.isInteger(deleted) || deleted < 0) {
    throw new Error("youtube_playlist_stale_cleanup_changes_unavailable");
  }

  if (deleted >= PLAYLIST_STALE_DELETE_BATCH_SIZE) {
    await env.DB.prepare(
      `UPDATE event_youtube_playlist_sync
       SET sync_status = 'scanning', scan_started_at = ?1,
            scan_page_token = ?2, next_sync_at = ?3,
            last_error = 'playlist_stale_cleanup_continuing',
            pending_trigger = 'continuation', updated_at = ?4
       WHERE event_id = ?5 AND playlist_id = ?6
         AND enabled = 1 AND sync_mode = ?7
         AND run_lease_token = ?8
         AND run_lease_expires_at = ?9
         AND run_lease_expires_at > ?4
         AND (pending_trigger IS NULL OR pending_trigger = 'continuation')`,
    )
      .bind(
        scanStartedAt,
        STALE_CLEANUP_CURSOR,
        now + RETRY_DELAY_SEC,
        now,
        config.event_id,
        config.playlist_id,
        config.sync_mode,
        config.run_id,
        config.run_lease_expires_at,
      )
      .run()
      .then((update) => {
        if (Number(update.meta?.changes ?? 0) !== 1) {
          throw new Error("youtube_playlist_config_changed");
        }
        return update;
      });
    signal?.throwIfAborted();
    return false;
  }

  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = 'idle', last_full_scan_at = ?1,
          scan_started_at = NULL, scan_page_token = NULL,
          next_sync_at = ?1, last_error = NULL, updated_at = ?1
       WHERE event_id = ?2 AND playlist_id = ?3
         AND enabled = 1 AND sync_mode = ?4
         AND run_lease_token = ?5
         AND run_lease_expires_at = ?6
         AND run_lease_expires_at > ?1
         AND (pending_trigger IS NULL OR pending_trigger = 'continuation')`,
  )
    .bind(
      now,
      config.event_id,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
    )
    .run()
    .then((result) => {
      if (Number(result.meta?.changes ?? 0) !== 1) {
        throw new Error("youtube_playlist_config_changed");
      }
      return result;
    });
  signal?.throwIfAborted();
  return true;
}

async function scanPlaylist(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  now: number,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<{ complete: boolean; detailCode: string | null }> {
  signal?.throwIfAborted();
  const scanStartedAt =
    config.scan_started_at ?? Math.max(now, (config.last_full_scan_at ?? 0) + 1);
  if (config.scan_page_token === STALE_CLEANUP_CURSOR) {
    const complete = await cleanupStaleScanItems(
      env,
      config,
      scanStartedAt,
      now,
      signal,
    );
    return {
      complete,
      detailCode: complete ? null : "playlist_stale_cleanup_continuing",
    };
  }
  let pageToken = config.scan_started_at ? config.scan_page_token : null;
  if (config.scan_started_at == null) {
    await markScanStarted(
      env,
      config,
      scanStartedAt,
      now,
      signal,
    );
  }

  for (let page = 0; page < MAX_SCAN_PAGES_PER_EVENT; page += 1) {
    signal?.throwIfAborted();
    const result = await listPlaylistPage(
      config.playlist_id,
      pageToken,
      accessToken,
      quota,
      requestBudget,
      signal,
      fetchImpl,
    );
    signal?.throwIfAborted();
    await upsertScannedItems(
      env,
      config,
      result.items,
      scanStartedAt,
      signal,
    );
    pageToken = result.nextPageToken;
    if (!pageToken) {
      signal?.throwIfAborted();
      await env.DB.prepare(
        `UPDATE event_youtube_playlist_sync
         SET sync_status = 'scanning', scan_started_at = ?1,
              scan_page_token = ?2,
              last_error = 'playlist_stale_cleanup_continuing',
              pending_trigger = 'continuation', updated_at = ?3
          WHERE event_id = ?4 AND playlist_id = ?5
            AND enabled = 1 AND sync_mode = ?6
            AND run_lease_token = ?7
            AND run_lease_expires_at = ?8
            AND run_lease_expires_at > ?3
            AND (pending_trigger IS NULL OR pending_trigger = 'continuation')`,
      )
        .bind(
          scanStartedAt,
          STALE_CLEANUP_CURSOR,
          now,
          config.event_id,
          config.playlist_id,
          config.sync_mode,
          config.run_id,
          config.run_lease_expires_at,
        )
        .run()
        .then((update) => {
          if (Number(update.meta?.changes ?? 0) !== 1) {
            throw new Error("youtube_playlist_config_changed");
          }
          return update;
        });
      signal?.throwIfAborted();
      const complete = await cleanupStaleScanItems(
        env,
        config,
        scanStartedAt,
        now,
        signal,
      );
      return {
        complete,
        detailCode: complete ? null : "playlist_stale_cleanup_continuing",
      };
    }
  }

  signal?.throwIfAborted();
  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = 'scanning', scan_started_at = ?1,
          scan_page_token = ?2, next_sync_at = ?3,
          last_error = 'playlist_scan_continuing',
          pending_trigger = 'continuation', updated_at = ?4
     WHERE event_id = ?5 AND playlist_id = ?6
       AND enabled = 1 AND sync_mode = ?7
       AND run_lease_token = ?8
       AND run_lease_expires_at = ?9
       AND run_lease_expires_at > ?4
       AND (pending_trigger IS NULL OR pending_trigger = 'continuation')`,
  )
    .bind(
      scanStartedAt,
      pageToken,
      now + RETRY_DELAY_SEC,
      now,
      config.event_id,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
    )
    .run()
    .then((update) => {
      if (Number(update.meta?.changes ?? 0) !== 1) {
        throw new Error("youtube_playlist_config_changed");
      }
      return update;
    });
  signal?.throwIfAborted();
  return { complete: false, detailCode: "playlist_scan_continuing" };
}

export function calculateSyncDiff(
  sourceVideoIds: readonly string[],
  remoteItems: readonly RemoteItemRow[],
  mode: PlaylistSyncMode,
): { additions: string[]; removals: RemoteItemRow[] } {
  const sourceSet = new Set(sourceVideoIds);
  const remoteVideoSet = new Set(remoteItems.map((item) => item.youtube_video_id));
  const seenSourceRemote = new Set<string>();
  const removals =
    mode === "mirror"
      ? remoteItems.filter((item) => {
          if (!sourceSet.has(item.youtube_video_id)) return true;
          if (seenSourceRemote.has(item.youtube_video_id)) return true;
          seenSourceRemote.add(item.youtube_video_id);
          return false;
        })
      : [];
  return {
    additions: sourceVideoIds.filter((videoId) => !remoteVideoSet.has(videoId)),
    removals,
  };
}

function errorCode(error: unknown): string {
  if (error instanceof QuotaDeferredError) return "youtube_quota_budget_deferred";
  if (error instanceof YouTubeApiError) {
    return `youtube_api_${error.status}_${normalizeYoutubeApiReason(error.reason)}`;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    // Persist only an allow-listed operational code.  Provider/network
    // exceptions may contain URLs, headers, OAuth values, or D1 text.
    if (/^(?:youtube|playlist|oauth|d1)_[a-z0-9_.:-]{1,140}$/i.test(message)) {
      return message;
    }
    if (/(?:network connection lost|connection reset|timed? out|fetch failed)/i.test(message)) {
      return "youtube_network_transient";
    }
  }
  return "youtube_playlist_sync_failed";
}

export function isYoutubeApiQuotaResponse(status: number, reason: string): boolean {
  return status === 429 || YOUTUBE_QUOTA_REASONS.has(reason);
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof QuotaDeferredError ||
    (error instanceof YouTubeApiError &&
      isYoutubeApiQuotaResponse(error.status, error.reason))
  );
}

function trimmedSecret(value: string | undefined): string {
  return value?.trim() ?? "";
}

async function markEventError(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  error: unknown,
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const deferred = isQuotaError(error);
  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = ?1, next_sync_at = ?2,
         last_error = ?3, last_full_scan_at = NULL,
         scan_started_at = NULL, scan_page_token = NULL, updated_at = ?4
     WHERE event_id = ?5 AND playlist_id = ?6
       AND enabled = 1 AND sync_mode = ?7
       AND run_lease_token = ?8
       AND run_lease_expires_at = ?9
       AND run_lease_expires_at > ?4
       AND (pending_trigger IS NULL OR pending_trigger = 'continuation')`,
  )
    .bind(
      deferred ? "deferred" : "failed",
      now + (deferred ? FULL_SCAN_INTERVAL_SEC : FAILURE_RETRY_SEC),
      errorCode(error),
      now,
      config.event_id,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
    )
    .run()
    .then((update) => {
      if (Number(update.meta?.changes ?? 0) !== 1) {
        throw new Error("youtube_playlist_config_changed");
      }
      return update;
    });
  signal?.throwIfAborted();
}

async function armPlaylistMutationRecovery(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const minimumLeaseExpiry = now + PLAYLIST_MUTATION_LEASE_SAFETY_SEC;
  const armed = await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
        SET last_full_scan_at = NULL,
            pending_trigger = COALESCE(pending_trigger, 'continuation'),
            next_sync_at = MIN(COALESCE(next_sync_at, ?1), ?1),
            updated_at = MAX(updated_at, ?1)
      WHERE event_id = ?2 AND playlist_id = ?3
        AND enabled = 1 AND sync_mode = ?4
        AND run_lease_token = ?5
        AND run_lease_expires_at = ?6
        AND run_lease_expires_at > ?7
        AND (pending_trigger IS NULL OR pending_trigger = 'continuation')`,
  )
    .bind(
      now,
      config.event_id,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
      minimumLeaseExpiry,
    )
    .run();
  if (Number(armed.meta?.changes ?? 0) !== 1) {
    throw new Error("youtube_playlist_config_changed");
  }
  signal?.throwIfAborted();
}

async function insertLocalItem(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  playlistItemId: string,
  videoId: string,
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await env.DB.prepare(
    `INSERT INTO event_youtube_playlist_items (
       event_id, playlist_item_id, youtube_video_id, seen_at,
       managed_by_flamenode, created_at
     )
     SELECT ?1, ?2, ?3, ?4, 1, ?4
     WHERE EXISTS (
       SELECT 1 FROM event_youtube_playlist_sync
       WHERE event_id = ?1 AND playlist_id = ?5
         AND enabled = 1 AND sync_mode = ?6
         AND run_lease_token = ?7
         AND run_lease_expires_at = ?8
         AND run_lease_expires_at > ?4
         AND (pending_trigger IS NULL OR pending_trigger = 'continuation')
     )
     ON CONFLICT(event_id, playlist_item_id) DO UPDATE SET
       youtube_video_id = excluded.youtube_video_id,
       seen_at = excluded.seen_at,
       managed_by_flamenode = 1`,
  )
    .bind(
      config.event_id,
      playlistItemId,
      videoId,
      now,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
    )
    .run()
    .then((result) => {
      if (Number(result.meta?.changes ?? 0) !== 1) {
        throw new Error("youtube_playlist_config_changed");
      }
      return result;
    });
  signal?.throwIfAborted();
}

async function syncOneEvent(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  mutationBudget: { remaining: number },
  now: number,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<PlaylistSyncRunOutcome> {
  signal?.throwIfAborted();
  const sourceVideoIds = await loadSourceVideoIds(
    env,
    config.event_id,
    signal,
  );
  const scanRequired =
    config.scan_started_at != null ||
    config.last_full_scan_at == null ||
    now - config.last_full_scan_at >= FULL_SCAN_INTERVAL_SEC;

  if (scanRequired) {
    const scan = await scanPlaylist(
      env,
      config,
      accessToken,
      quota,
      requestBudget,
      now,
      signal,
      fetchImpl,
    );
    if (!scan.complete) {
      return { status: "deferred", detailCode: scan.detailCode };
    }
  }

  signal?.throwIfAborted();
  const remoteItems = await loadRemoteItems(env, config.event_id, signal);
  const { additions, removals } = calculateSyncDiff(
    sourceVideoIds,
    remoteItems,
    config.sync_mode,
  );
  let added = 0;
  let removed = 0;
  let orderFallback = false;
  let orderRepairPending = false;
  let orderRepairWarning: string | null = null;
  const sourcePositions = new Map(
    sourceVideoIds.map((videoId, index) => [videoId, index]),
  );

  for (const videoId of additions) {
    signal?.throwIfAborted();
    // position指定失敗時の末尾追加まで含め、最大100 units / 2 subrequestを確保してから開始する。
    if (
      mutationBudget.remaining <= 0 ||
      requestBudget.remaining < 2 ||
      !quota.canSpend(100)
    ) {
      break;
    }
    await armPlaylistMutationRecovery(env, config, unixNow(), signal);
    const position = sourcePositions.get(videoId) ?? 0;
    const inserted = await insertPlaylistItem(
      config.playlist_id,
      videoId,
      Math.max(0, position),
      accessToken,
      quota,
      requestBudget,
      signal,
      fetchImpl,
    );
    signal?.throwIfAborted();
    mutationBudget.remaining -= 1;
    orderFallback ||= !inserted.ordered;
    await insertLocalItem(
      env,
      config,
      inserted.id,
      videoId,
      now,
      signal,
    );
    added += 1;
  }

  for (const item of removals) {
    signal?.throwIfAborted();
    if (
      mutationBudget.remaining <= 0 ||
      requestBudget.remaining <= 0 ||
      !quota.canSpend(50)
    ) {
      break;
    }
    await armPlaylistMutationRecovery(env, config, unixNow(), signal);
    await deletePlaylistItem(
      item.playlist_item_id,
      accessToken,
      quota,
      requestBudget,
      signal,
      fetchImpl,
    );
    signal?.throwIfAborted();
    mutationBudget.remaining -= 1;
    await env.DB.prepare(
      `DELETE FROM event_youtube_playlist_items
       WHERE event_id = ?1 AND playlist_item_id = ?2
         AND EXISTS (
           SELECT 1 FROM event_youtube_playlist_sync
           WHERE event_id = ?1 AND playlist_id = ?3
             AND enabled = 1 AND sync_mode = ?4
             AND run_lease_token = ?5
             AND run_lease_expires_at = ?6
             AND run_lease_expires_at > ?7
             AND (pending_trigger IS NULL OR pending_trigger = 'continuation')
         )`,
    )
      .bind(
        config.event_id,
        item.playlist_item_id,
        config.playlist_id,
        config.sync_mode,
        config.run_id,
        config.run_lease_expires_at,
        unixNow(),
      )
      .run()
      .then((result) => {
        if (Number(result.meta?.changes ?? 0) !== 1) {
          throw new Error("youtube_playlist_config_changed");
        }
        return result;
      });
    signal?.throwIfAborted();
    removed += 1;
  }

  const mutationDiffRemaining =
    added < additions.length || removed < removals.length;
  const shouldRepairOrder =
    sourceVideoIds.length > 1 &&
    !mutationDiffRemaining &&
    !orderFallback &&
    mutationBudget.remaining > 0 &&
    (scanRequired ||
      added > 0 ||
      removed > 0 ||
      config.last_error === "playlist_order_repair_continuing" ||
      config.last_error === "playlist_order_repair_request_budget");

  if (shouldRepairOrder) {
    const snapshot = await loadPlaylistOrderSnapshot(
      config.playlist_id,
      accessToken,
      quota,
      requestBudget,
      signal,
      fetchImpl,
    );
    if (!snapshot.complete) {
      if (snapshot.reason === "request_budget") {
        orderRepairPending = true;
        orderRepairWarning = "playlist_order_repair_request_budget";
      } else if (snapshot.reason === "quota") {
        orderRepairWarning = "playlist_order_repair_quota_deferred";
      } else {
        orderRepairWarning = "playlist_order_repair_scan_limit_exceeded";
      }
    } else {
      const workingOrder = [...snapshot.items];
      let repaired = 0;
      while (
        repaired < MAX_ORDER_REPAIRS_PER_RUN &&
        mutationBudget.remaining > 0
      ) {
        signal?.throwIfAborted();
        const plan = planPlaylistOrderRepair(sourceVideoIds, workingOrder);
        if (plan.status === "aligned") break;
        if (plan.status === "ambiguous") {
          orderRepairWarning = "playlist_order_repair_ambiguous_remote_items";
          break;
        }
        if (!quota.canSpend(50) || requestBudget.remaining <= 0) {
          orderRepairPending = true;
          orderRepairWarning = "playlist_order_repair_request_budget";
          break;
        }
        await armPlaylistMutationRecovery(env, config, unixNow(), signal);
        const moved = await updatePlaylistItemPosition(
          config.playlist_id,
          { playlistItemId: plan.playlistItemId, videoId: plan.videoId },
          plan.toIndex,
          accessToken,
          quota,
          requestBudget,
          signal,
          fetchImpl,
        );
        if (!moved) {
          orderFallback = true;
          break;
        }
        mutationBudget.remaining -= 1;
        repaired += 1;
        applyLocalOrderMove(workingOrder, plan.fromIndex, plan.toIndex);
      }

      if (!orderFallback && !orderRepairWarning) {
        const remainingPlan = planPlaylistOrderRepair(sourceVideoIds, workingOrder);
        if (remainingPlan.status === "move") {
          orderRepairPending = true;
          orderRepairWarning = "playlist_order_repair_continuing";
        } else if (remainingPlan.status === "ambiguous") {
          orderRepairWarning = "playlist_order_repair_ambiguous_remote_items";
        }
      }
    }
  }

  const hasRemaining = mutationDiffRemaining || orderRepairPending;
  const lastError = mutationDiffRemaining
    ? "playlist_mutation_batch_continuing"
    : orderFallback
      ? "playlist_order_fallback_manual_sort_required"
      : orderRepairWarning;
  signal?.throwIfAborted();
  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = ?1, next_sync_at = ?2,
         last_synced_at = ?3, last_error = ?4,
         pending_trigger = ?5, last_full_scan_at = ?6, updated_at = ?7
     WHERE event_id = ?8 AND playlist_id = ?9
       AND enabled = 1 AND sync_mode = ?10
       AND run_lease_token = ?11
       AND run_lease_expires_at = ?12
       AND run_lease_expires_at > ?7
       AND (pending_trigger IS NULL OR pending_trigger = 'continuation')`,
  )
    .bind(
      hasRemaining ? "deferred" : "synced",
      hasRemaining
        ? now + RETRY_DELAY_SEC
        : now + Math.max(60, config.sync_interval_minutes) * 60,
      hasRemaining ? config.last_synced_at : now,
      lastError,
      hasRemaining ? "continuation" : null,
      scanRequired ? now : config.last_full_scan_at,
      now,
      config.event_id,
      config.playlist_id,
      config.sync_mode,
      config.run_id,
      config.run_lease_expires_at,
    )
    .run()
    .then((update) => {
      if (Number(update.meta?.changes ?? 0) !== 1) {
        throw new Error("youtube_playlist_config_changed");
      }
      return update;
    });
  signal?.throwIfAborted();
  return {
    status: hasRemaining ? "deferred" : "succeeded",
    detailCode: lastError,
  };
}

async function releasePlaylistSyncClaim(
  env: PlaylistSyncEnv,
  config: ClaimedSyncConfig,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
        SET run_lease_token = NULL,
            run_lease_expires_at = NULL,
            updated_at = MAX(updated_at, ?1)
      WHERE event_id = ?2
        AND playlist_id = ?3
        AND run_lease_token = ?4
        AND run_lease_expires_at = ?5`,
  )
    .bind(unixNow(), config.event_id, config.playlist_id, config.run_id, config.run_lease_expires_at)
    .run();
  signal?.throwIfAborted();
}

export async function syncEventPlaylists(
  env: PlaylistSyncEnv,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
  context: PlaylistSyncRunContext = {
    runId: crypto.randomUUID(),
    trigger: "scheduled",
    dispatchSource: "direct",
  },
): Promise<PlaylistSyncBatchResult> {
  signal?.throwIfAborted();
  const result = (
    base: Pick<PlaylistSyncBatchResult, "processed" | "skipped" | "failed">,
    extra: Partial<PlaylistSyncBatchResult> = {},
  ): PlaylistSyncBatchResult => ({
    external_api_calls: 0,
    d1_changes: 0,
    retry_count: 0,
    quota_stopped: false,
    quota_stop_reason: null,
    notification_wake_count: 0,
    ...base,
    ...extra,
  });
  const changes = { value: 0 };
  const trackedEnv = {
    ...env,
    DB: new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare" && property !== "batch") {
          return Reflect.get(target, property, receiver);
        }
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements);
            changes.value += results.reduce(
              (sum, item) => sum + Math.max(0, Number(item?.meta?.changes ?? 0)),
              0,
            );
            return results;
          };
        }
        return (sql: string) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(stmt, key, recv) {
              if (key !== "bind") return Reflect.get(stmt, key, recv);
              return (...args: unknown[]) => {
                const bound = stmt.bind(...args);
                return new Proxy(bound, {
                  get(inner, innerKey, innerRecv) {
                    if (innerKey !== "run") {
                      return Reflect.get(inner, innerKey, innerRecv);
                    }
                    return async () => {
                      const outcome = await inner.run();
                      changes.value += Math.max(
                        0,
                        Number(outcome?.meta?.changes ?? 0),
                      );
                      return outcome;
                    };
                  },
                });
              };
            },
          });
        };
      },
    }),
  } as PlaylistSyncEnv;
  const hasOAuth =
    trimmedSecret(env.YOUTUBE_OAUTH_CLIENT_ID) !== "" &&
    trimmedSecret(env.YOUTUBE_OAUTH_CLIENT_SECRET) !== "" &&
    trimmedSecret(env.YOUTUBE_OAUTH_REFRESH_TOKEN) !== "";
  if (!hasOAuth) return result({ processed: 0, skipped: 1, failed: 0 });

  const now = unixNow();
  const configs = await loadDueConfigs(trackedEnv, now, signal);
  if (configs.length === 0) {
    return result({ processed: 0, skipped: 1, failed: 0 });
  }

  const requestBudget = new ExternalRequestBudget(MAX_EXTERNAL_REQUESTS_PER_RUN);
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let quotaStopped = false;
  let quotaD1Changes = 0;
  let notificationWakeCount = 0;
  const mutationBudget = { remaining: MAX_MUTATIONS_PER_RUN };
  for (const config of configs.slice(0, MAX_EVENTS_PER_RUN)) {
    signal?.throwIfAborted();
    const claimed = await claimPlaylistSyncConfig(
      trackedEnv,
      config,
      context,
      now,
    );
    if (!claimed) {
      skipped += 1;
      continue;
    }
    let started = false;
    try {
      await beginPlaylistSyncRun(trackedEnv, claimed, now);
      started = true;
      // Claim/history start precedes OAuth refresh so provider failures are
      // observable under the same run_id and always release their lease.
      const quota = await DailyQuotaBudget.load(trackedEnv, now, signal);
      quotaD1Changes += quota.d1Changes;
      const accessToken = await refreshAccessToken(
        trackedEnv,
        requestBudget,
        signal,
        fetchImpl,
      );
      const outcome = await syncOneEvent(
        trackedEnv,
        claimed,
        accessToken,
        quota,
        requestBudget,
        mutationBudget,
        now,
        signal,
        fetchImpl,
      );
      if (await finishPlaylistSyncRun(trackedEnv, claimed, outcome, unixNow())) {
        notificationWakeCount += 1;
      }
      processed += 1;
    } catch (error) {
      const aborted = signal?.aborted === true ||
        (error instanceof DOMException && error.name === "AbortError");
      if (started) {
        if (aborted) {
          // Deadline/abort must not strand the lease or a running history row.
          // The cleanup is identity-fenced and intentionally does not receive
          // the already-aborted signal.
          await abortPlaylistSyncRun(trackedEnv, claimed, unixNow(), "aborted");
        } else {
          const deferred = isQuotaError(error);
          try {
            await markEventError(trackedEnv, claimed, error, unixNow(), signal);
            if (await finishPlaylistSyncRun(
              trackedEnv,
              claimed,
              {
                status: deferred ? "deferred" : "failed",
                detailCode: errorCode(error),
              },
              unixNow(),
            )) {
              notificationWakeCount += 1;
            }
          } catch (finalizationError) {
            // A settings/manual/rename CAS can invalidate the run between the
            // error write and finish. Close its history by run_id instead of
            // allowing a permanent `running` row.
            await abortPlaylistSyncRun(trackedEnv, claimed, unixNow(), "superseded");
            throw finalizationError;
          }
        }
      } else {
        await releasePlaylistSyncClaim(trackedEnv, claimed, aborted ? undefined : signal);
      }
      failed += 1;
      if (aborted) throw error;
      if (isQuotaError(error)) {
        quotaStopped = true;
        break;
      }
    }
  }

  signal?.throwIfAborted();
  return result(
    { processed, skipped, failed },
    {
      external_api_calls: requestBudget.used,
      d1_changes: changes.value + quotaD1Changes,
      quota_stopped: quotaStopped,
      quota_stop_reason: quotaStopped ? "youtube_quota_deferred" : null,
      notification_wake_count: notificationWakeCount,
    },
  );
}
