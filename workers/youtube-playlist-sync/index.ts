import {
  loadYoutubeQuotaSnapshot,
  reserveYoutubeQuota,
  type YoutubeQuotaEnv,
} from "../youtube-sync/quotaBudget.ts";
import {
  cancelResponseBody,
  ExternalRequestBudget,
  fetchWithTimeout,
} from "../shared/externalApi.ts";

export interface PlaylistSyncEnv extends YoutubeQuotaEnv {
  KV: KVNamespace;
  YOUTUBE_OAUTH_CLIENT_ID?: string;
  YOUTUBE_OAUTH_CLIENT_SECRET?: string;
  YOUTUBE_OAUTH_REFRESH_TOKEN?: string;
}

export type PlaylistSyncMode = "append_only" | "mirror";

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

export interface PlaylistSyncBatchResult {
  processed: number;
  skipped: number;
  failed: number;
}

const MAX_EVENTS_PER_RUN = 1;
const MAX_SCAN_PAGES_PER_EVENT = 3;
const MAX_MUTATIONS_PER_RUN = 4;
const MAX_SOURCE_VIDEOS = 5000;
const SCAN_UPSERT_CHUNK_SIZE = 20;
const FULL_SCAN_INTERVAL_SEC = 24 * 60 * 60;
const RETRY_DELAY_SEC = 60 * 60;
const FAILURE_RETRY_SEC = 6 * 60 * 60;
const API_TIMEOUT_MS = 10_000;
/** OAuth 1 + scan 3 + insertion fallback込みmutation 8。 */
const MAX_EXTERNAL_REQUESTS_PER_RUN = 12;
const OAUTH_TOKEN_SAFETY_MS = 60_000;

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

class DailyQuotaBudget {
  private readonly env: PlaylistSyncEnv;
  private readonly now: number;
  private remainingUnits: number;

  private constructor(
    env: PlaylistSyncEnv,
    now: number,
    remainingUnits: number,
  ) {
    this.env = env;
    this.now = now;
    this.remainingUnits = remainingUnits;
  }

  static async load(env: PlaylistSyncEnv, now: number): Promise<DailyQuotaBudget> {
    const snapshot = await loadYoutubeQuotaSnapshot(env, now);
    return new DailyQuotaBudget(env, now, snapshot.remainingUnits);
  }

  canSpend(cost: number): boolean {
    return cost > 0 && cost <= this.remainingUnits;
  }

  async spend(cost: number): Promise<void> {
    if (!this.canSpend(cost)) throw new QuotaDeferredError();
    const reservation = await reserveYoutubeQuota(this.env, cost, this.now);
    if (!reservation) {
      this.remainingUnits = 0;
      throw new QuotaDeferredError();
    }
    this.remainingUnits = Math.max(
      0,
      reservation.dailyBudgetUnits - reservation.usedUnits,
    );
  }

}

async function readApiError(response: Response): Promise<YouTubeApiError> {
  let reason = "request_failed";
  try {
    const body = (await response.json()) as {
      error?: { errors?: Array<{ reason?: string }>; status?: string };
    };
    reason =
      body.error?.errors?.[0]?.reason ??
      body.error?.status?.toLowerCase() ??
      reason;
  } catch {
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
): Promise<string> {
  const now = Date.now();
  const cached = tokenState.__flamenodeYoutubePlaylistAccessToken;
  if (cached && cached.expiresAt - now > OAUTH_TOKEN_SAFETY_MS) {
    return cached.value;
  }

  const response = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.YOUTUBE_OAUTH_CLIENT_ID ?? "",
        client_secret: env.YOUTUBE_OAUTH_CLIENT_SECRET ?? "",
        refresh_token: env.YOUTUBE_OAUTH_REFRESH_TOKEN ?? "",
        grant_type: "refresh_token",
      }),
    },
    {
      timeoutMs: API_TIMEOUT_MS,
      budget: requestBudget,
      budgetErrorCode: "youtube_playlist_request_budget_exhausted",
      timeoutErrorCode: "youtube_oauth_timeout",
      networkErrorCode: "youtube_oauth_network_error",
    },
  );
  if (!response.ok) throw await readApiError(response);
  const body = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
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
): Promise<T> {
  await quota.spend(cost);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetchWithTimeout(
    url,
    { ...init, headers },
    {
      timeoutMs: API_TIMEOUT_MS,
      budget: requestBudget,
      budgetErrorCode: "youtube_playlist_request_budget_exhausted",
      timeoutErrorCode: "youtube_playlist_api_timeout",
      networkErrorCode: "youtube_playlist_api_network_error",
    },
  );
  if (!response.ok) {
    const error = await readApiError(response);
    if (response.status === 401) clearCachedAccessToken();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function listPlaylistPage(
  playlistId: string,
  pageToken: string | null,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
): Promise<PlaylistPage> {
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
  }>(url, { method: "GET" }, accessToken, quota, requestBudget, 1);

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
): Promise<string> {
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
): Promise<InsertedPlaylistItem> {
  try {
    return {
      id: await postPlaylistItem(
        playlistId,
        videoId,
        position,
        accessToken,
        quota,
        requestBudget,
      ),
      ordered: true,
    };
  } catch (error) {
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
      ),
      ordered: false,
    };
  }
}

async function deletePlaylistItem(
  playlistItemId: string,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
): Promise<void> {
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
    );
  } catch (error) {
    if (error instanceof YouTubeApiError && error.status === 404) return;
    throw error;
  }
}

async function loadDueConfigs(
  env: PlaylistSyncEnv,
  now: number,
): Promise<SyncConfigRow[]> {
  const result = await env.DB.prepare(
    `SELECT event_id, playlist_id, sync_mode, sync_interval_minutes,
            sync_status, next_sync_at, last_synced_at, last_full_scan_at,
            scan_started_at, scan_page_token
     FROM event_youtube_playlist_sync
     WHERE enabled = 1
       AND playlist_id IS NOT NULL
       AND playlist_id <> ''
       AND sync_mode IN ('append_only', 'mirror')
       AND COALESCE(next_sync_at, 0) <= ?1
     ORDER BY CASE WHEN scan_started_at IS NULL THEN 1 ELSE 0 END,
              COALESCE(next_sync_at, 0), event_id
     LIMIT ?2`,
  )
    .bind(now, MAX_EVENTS_PER_RUN)
    .all<SyncConfigRow>();
  return result.results ?? [];
}

async function loadSourceVideoIds(
  env: PlaylistSyncEnv,
  eventId: string,
): Promise<string[]> {
  const result = await env.DB.prepare(
    `SELECT v.youtube_video_id
     FROM video_events ve
     INNER JOIN videos v ON v.id = ve.video_id
     WHERE ve.event_id = ?1
       AND v.youtube_video_id IS NOT NULL
       AND v.youtube_video_id <> ''
       AND v.visibility_status IN ('public', 'limited')
     GROUP BY v.youtube_video_id
     ORDER BY MIN(COALESCE(v.scheduled_time, v.created_at)), MIN(v.id)
     LIMIT ?2`,
  )
    .bind(eventId, MAX_SOURCE_VIDEOS + 1)
    .all<{ youtube_video_id: string }>();
  const rows = result.results ?? [];
  if (rows.length > MAX_SOURCE_VIDEOS) {
    throw new Error("youtube_playlist_source_limit_exceeded");
  }
  return rows.map((row) => row.youtube_video_id);
}

async function loadRemoteItems(
  env: PlaylistSyncEnv,
  eventId: string,
): Promise<RemoteItemRow[]> {
  const result = await env.DB.prepare(
    `SELECT playlist_item_id, youtube_video_id
     FROM event_youtube_playlist_items
     WHERE event_id = ?1
     ORDER BY created_at, playlist_item_id`,
  )
    .bind(eventId)
    .all<RemoteItemRow>();
  return result.results ?? [];
}

async function upsertScannedItems(
  env: PlaylistSyncEnv,
  eventId: string,
  items: PlaylistPageItem[],
  seenAt: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < items.length; offset += SCAN_UPSERT_CHUNK_SIZE) {
    const chunk = items.slice(offset, offset + SCAN_UPSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, 0, ?)").join(", ");
    const values = chunk.flatMap((item) => [
      eventId,
      item.playlistItemId,
      item.videoId,
      seenAt,
      seenAt,
    ]);
    statements.push(
      env.DB.prepare(
        `INSERT INTO event_youtube_playlist_items (
           event_id, playlist_item_id, youtube_video_id, seen_at,
           managed_by_flamenode, created_at
         ) VALUES ${placeholders}
         ON CONFLICT(event_id, playlist_item_id) DO UPDATE SET
           youtube_video_id = excluded.youtube_video_id,
           seen_at = excluded.seen_at`,
      ).bind(...values),
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

async function markScanStarted(
  env: PlaylistSyncEnv,
  eventId: string,
  scanStartedAt: number,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = 'scanning', scan_started_at = ?1,
         scan_page_token = NULL, last_error = NULL, updated_at = ?2
     WHERE event_id = ?3`,
  )
    .bind(scanStartedAt, now, eventId)
    .run();
}

async function scanPlaylist(
  env: PlaylistSyncEnv,
  config: SyncConfigRow,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  now: number,
): Promise<boolean> {
  const scanStartedAt =
    config.scan_started_at ?? Math.max(now, (config.last_full_scan_at ?? 0) + 1);
  let pageToken = config.scan_started_at ? config.scan_page_token : null;
  if (config.scan_started_at == null) {
    await markScanStarted(env, config.event_id, scanStartedAt, now);
  }

  for (let page = 0; page < MAX_SCAN_PAGES_PER_EVENT; page += 1) {
    const result = await listPlaylistPage(
      config.playlist_id,
      pageToken,
      accessToken,
      quota,
      requestBudget,
    );
    await upsertScannedItems(env, config.event_id, result.items, scanStartedAt);
    pageToken = result.nextPageToken;
    if (!pageToken) {
      await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM event_youtube_playlist_items
           WHERE event_id = ?1 AND seen_at <> ?2`,
        ).bind(config.event_id, scanStartedAt),
        env.DB.prepare(
          `UPDATE event_youtube_playlist_sync
           SET sync_status = 'idle', last_full_scan_at = ?1,
               scan_started_at = NULL, scan_page_token = NULL,
               next_sync_at = ?1, last_error = NULL, updated_at = ?1
           WHERE event_id = ?2`,
        ).bind(now, config.event_id),
      ]);
      return true;
    }
  }

  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = 'scanning', scan_started_at = ?1,
         scan_page_token = ?2, next_sync_at = ?3,
         last_error = 'playlist_scan_continuing', updated_at = ?4
     WHERE event_id = ?5`,
  )
    .bind(scanStartedAt, pageToken, now + RETRY_DELAY_SEC, now, config.event_id)
    .run();
  return false;
}

export function calculateSyncDiff(
  sourceVideoIds: readonly string[],
  remoteItems: readonly RemoteItemRow[],
  mode: PlaylistSyncMode,
): { additions: string[]; removals: RemoteItemRow[] } {
  const sourceSet = new Set(sourceVideoIds);
  const remoteVideoSet = new Set(remoteItems.map((item) => item.youtube_video_id));
  return {
    additions: sourceVideoIds.filter((videoId) => !remoteVideoSet.has(videoId)),
    removals:
      mode === "mirror"
        ? remoteItems.filter((item) => !sourceSet.has(item.youtube_video_id))
        : [],
  };
}

function errorCode(error: unknown): string {
  if (error instanceof QuotaDeferredError) return "youtube_quota_budget_deferred";
  if (error instanceof YouTubeApiError) {
    return `youtube_api_${error.status}_${error.reason}`.slice(0, 160);
  }
  if (error instanceof Error) return error.message.slice(0, 160);
  return "youtube_playlist_sync_failed";
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof QuotaDeferredError ||
    (error instanceof YouTubeApiError &&
      (error.status === 429 ||
        error.reason === "quotaExceeded" ||
        error.reason === "dailyLimitExceeded"))
  );
}

async function markEventError(
  env: PlaylistSyncEnv,
  eventId: string,
  error: unknown,
  now: number,
): Promise<void> {
  const deferred = isQuotaError(error);
  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = ?1, next_sync_at = ?2,
         last_error = ?3, last_full_scan_at = NULL,
         scan_started_at = NULL, scan_page_token = NULL, updated_at = ?4
     WHERE event_id = ?5`,
  )
    .bind(
      deferred ? "deferred" : "failed",
      now + (deferred ? FULL_SCAN_INTERVAL_SEC : FAILURE_RETRY_SEC),
      errorCode(error),
      now,
      eventId,
    )
    .run();
}

async function insertLocalItem(
  env: PlaylistSyncEnv,
  eventId: string,
  playlistItemId: string,
  videoId: string,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_youtube_playlist_items (
       event_id, playlist_item_id, youtube_video_id, seen_at,
       managed_by_flamenode, created_at
     ) VALUES (?1, ?2, ?3, ?4, 1, ?4)
     ON CONFLICT(event_id, playlist_item_id) DO UPDATE SET
       youtube_video_id = excluded.youtube_video_id,
       seen_at = excluded.seen_at,
       managed_by_flamenode = 1`,
  )
    .bind(eventId, playlistItemId, videoId, now)
    .run();
}

async function syncOneEvent(
  env: PlaylistSyncEnv,
  config: SyncConfigRow,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  mutationBudget: { remaining: number },
  now: number,
): Promise<void> {
  const sourceVideoIds = await loadSourceVideoIds(env, config.event_id);
  const scanRequired =
    config.scan_started_at != null ||
    config.last_full_scan_at == null ||
    now - config.last_full_scan_at >= FULL_SCAN_INTERVAL_SEC;

  if (scanRequired) {
    const scanComplete = await scanPlaylist(
      env,
      config,
      accessToken,
      quota,
      requestBudget,
      now,
    );
    if (!scanComplete) return;
  }

  const remoteItems = await loadRemoteItems(env, config.event_id);
  const { additions, removals } = calculateSyncDiff(
    sourceVideoIds,
    remoteItems,
    config.sync_mode,
  );
  let added = 0;
  let removed = 0;
  let orderFallback = false;
  const sourcePositions = new Map(
    sourceVideoIds.map((videoId, index) => [videoId, index]),
  );

  for (const videoId of additions) {
    // position指定失敗時の末尾追加まで含め、最大100 unitsを確保してから開始する。
    if (mutationBudget.remaining <= 0 || !quota.canSpend(100)) break;
    const position = sourcePositions.get(videoId) ?? 0;
    const inserted = await insertPlaylistItem(
      config.playlist_id,
      videoId,
      Math.max(0, position),
      accessToken,
      quota,
      requestBudget,
    );
    mutationBudget.remaining -= 1;
    orderFallback ||= !inserted.ordered;
    await insertLocalItem(env, config.event_id, inserted.id, videoId, now);
    added += 1;
  }

  for (const item of removals) {
    if (mutationBudget.remaining <= 0 || !quota.canSpend(50)) break;
    await deletePlaylistItem(
      item.playlist_item_id,
      accessToken,
      quota,
      requestBudget,
    );
    mutationBudget.remaining -= 1;
    await env.DB.prepare(
      `DELETE FROM event_youtube_playlist_items
       WHERE event_id = ?1 AND playlist_item_id = ?2`,
    )
      .bind(config.event_id, item.playlist_item_id)
      .run();
    removed += 1;
  }

  const hasRemaining =
    added < additions.length || removed < removals.length;
  const lastError = hasRemaining
    ? "playlist_mutation_batch_continuing"
    : orderFallback
      ? "playlist_order_fallback_manual_sort_required"
      : null;
  await env.DB.prepare(
    `UPDATE event_youtube_playlist_sync
     SET sync_status = ?1, next_sync_at = ?2,
         last_synced_at = ?3, last_error = ?4, updated_at = ?5
     WHERE event_id = ?6`,
  )
    .bind(
      hasRemaining ? "deferred" : "synced",
      hasRemaining
        ? now + RETRY_DELAY_SEC
        : now + Math.max(60, config.sync_interval_minutes) * 60,
      hasRemaining ? config.last_synced_at : now,
      lastError,
      now,
      config.event_id,
    )
    .run();
  return;
}

async function markOAuthFailure(
  env: PlaylistSyncEnv,
  configs: readonly SyncConfigRow[],
  error: unknown,
  now: number,
): Promise<void> {
  const code = errorCode(error);
  for (const config of configs) {
    await env.DB.prepare(
      `UPDATE event_youtube_playlist_sync
       SET sync_status = 'failed', next_sync_at = ?1,
           last_error = ?2, updated_at = ?3
       WHERE event_id = ?4`,
    )
      .bind(now + FAILURE_RETRY_SEC, code, now, config.event_id)
      .run();
  }
}

export async function syncEventPlaylists(
  env: PlaylistSyncEnv,
): Promise<PlaylistSyncBatchResult> {
  const hasOAuth =
    Boolean(env.YOUTUBE_OAUTH_CLIENT_ID) &&
    Boolean(env.YOUTUBE_OAUTH_CLIENT_SECRET) &&
    Boolean(env.YOUTUBE_OAUTH_REFRESH_TOKEN);
  if (!hasOAuth) return { processed: 0, skipped: 1, failed: 0 };

  const now = unixNow();
  const configs = await loadDueConfigs(env, now);
  if (configs.length === 0) return { processed: 0, skipped: 1, failed: 0 };

  const quota = await DailyQuotaBudget.load(env, now);
  const requestBudget = new ExternalRequestBudget(MAX_EXTERNAL_REQUESTS_PER_RUN);
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(env, requestBudget);
  } catch (error) {
    await markOAuthFailure(env, configs, error, now);
    return { processed: 0, skipped: 0, failed: configs.length };
  }

  let processed = 0;
  let failed = 0;
  const mutationBudget = { remaining: MAX_MUTATIONS_PER_RUN };
  for (const config of configs) {
    try {
      await syncOneEvent(
        env,
        config,
        accessToken,
        quota,
        requestBudget,
        mutationBudget,
        now,
      );
      processed += 1;
    } catch (error) {
      await markEventError(env, config.event_id, error, now);
      failed += 1;
      if (isQuotaError(error)) break;
    }
  }

  return { processed, skipped: 0, failed };
}
