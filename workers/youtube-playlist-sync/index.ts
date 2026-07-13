export interface PlaylistSyncEnv {
  DB: D1Database;
  KV: KVNamespace;
  YOUTUBE_OAUTH_CLIENT_ID?: string;
  YOUTUBE_OAUTH_CLIENT_SECRET?: string;
  YOUTUBE_OAUTH_REFRESH_TOKEN?: string;
  YOUTUBE_PLAYLIST_DAILY_QUOTA_UNITS?: string;
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

export interface PlaylistSyncBatchResult {
  processed: number;
  skipped: number;
  failed: number;
}

const MAX_EVENTS_PER_RUN = 2;
const MAX_SCAN_PAGES_PER_EVENT = 3;
const MAX_MUTATIONS_PER_RUN = 8;
const MAX_SOURCE_VIDEOS = 5000;
const FULL_SCAN_INTERVAL_SEC = 24 * 60 * 60;
const RETRY_DELAY_SEC = 60 * 60;
const FAILURE_RETRY_SEC = 6 * 60 * 60;
const DEFAULT_DAILY_QUOTA_UNITS = 4500;
const MAX_DAILY_QUOTA_UNITS = 8000;
const QUOTA_STATE_KEY = "youtube-playlist:quota-state";
const API_TIMEOUT_MS = 10_000;

class QuotaDeferredError extends Error {
  constructor() {
    super("youtube_playlist_quota_deferred");
    this.name = "QuotaDeferredError";
  }
}

class YouTubeApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`youtube_api_${status}_${reason}`);
    this.name = "YouTubeApiError";
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function quotaDayKey(now: number): string {
  return new Date(now * 1000).toISOString().slice(0, 10);
}

export function parseDailyQuotaLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_DAILY_QUOTA_UNITS;
  return Math.min(
    MAX_DAILY_QUOTA_UNITS,
    Math.max(500, Math.floor(parsed)),
  );
}

class DailyQuotaBudget {
  private dirty = false;

  private constructor(
    private readonly env: PlaylistSyncEnv,
    readonly day: string,
    readonly limit: number,
    private units: number,
  ) {}

  static async load(env: PlaylistSyncEnv, now: number): Promise<DailyQuotaBudget> {
    const day = quotaDayKey(now);
    let units = 0;
    try {
      const raw = await env.KV.get(QUOTA_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { day?: unknown; units?: unknown };
        if (parsed.day === day && Number.isFinite(Number(parsed.units))) {
          units = Math.max(0, Math.floor(Number(parsed.units)));
        }
      }
    } catch {
      units = 0;
    }
    return new DailyQuotaBudget(
      env,
      day,
      parseDailyQuotaLimit(env.YOUTUBE_PLAYLIST_DAILY_QUOTA_UNITS),
      units,
    );
  }

  canSpend(cost: number): boolean {
    return this.units + cost <= this.limit;
  }

  spend(cost: number): void {
    if (!this.canSpend(cost)) throw new QuotaDeferredError();
    this.units += cost;
    this.dirty = true;
  }

  async persist(): Promise<void> {
    if (!this.dirty) return;
    await this.env.KV.put(
      QUOTA_STATE_KEY,
      JSON.stringify({ day: this.day, units: this.units }),
      { expirationTtl: 3 * 24 * 60 * 60 },
    );
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
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
    // API本文をログやDBへ保存しない。
  }
  return new YouTubeApiError(response.status, reason.slice(0, 80));
}

async function refreshAccessToken(env: PlaylistSyncEnv): Promise<string> {
  const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.YOUTUBE_OAUTH_CLIENT_ID ?? "",
      client_secret: env.YOUTUBE_OAUTH_CLIENT_SECRET ?? "",
      refresh_token: env.YOUTUBE_OAUTH_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw await readApiError(response);
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("youtube_oauth_access_token_missing");
  }
  return body.access_token;
}

async function youtubeJson<T>(
  url: URL,
  init: RequestInit,
  accessToken: string,
  quota: DailyQuotaBudget,
  cost: number,
): Promise<T> {
  quota.spend(cost);
  const response = await fetchWithTimeout(url.toString(), {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw await readApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function listPlaylistPage(
  playlistId: string,
  pageToken: string | null,
  accessToken: string,
  quota: DailyQuotaBudget,
): Promise<PlaylistPage> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", "50");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const body = await youtubeJson<{
    nextPageToken?: string;
    items?: Array<{
      id?: string;
      snippet?: { resourceId?: { videoId?: string } };
    }>;
  }>(url, { method: "GET" }, accessToken, quota, 1);

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

async function insertPlaylistItem(
  playlistId: string,
  videoId: string,
  accessToken: string,
  quota: DailyQuotaBudget,
): Promise<string> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
  const body = await youtubeJson<{ id?: string }>(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: { kind: "youtube#video", videoId },
        },
      }),
    },
    accessToken,
    quota,
    50,
  );
  if (!body.id) throw new Error("youtube_playlist_item_id_missing");
  return body.id;
}

async function deletePlaylistItem(
  playlistItemId: string,
  accessToken: string,
  quota: DailyQuotaBudget,
): Promise<void> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("id", playlistItemId);
  try {
    await youtubeJson<void>(
      url,
      { method: "DELETE" },
      accessToken,
      quota,
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
     ORDER BY COALESCE(v.scheduled_time, v.created_at), v.id
     LIMIT ?2`,
  )
    .bind(eventId, MAX_SOURCE_VIDEOS + 1)
    .all<{ youtube_video_id: string }>();
  const rows = result.results ?? [];
  if (rows.length > MAX_SOURCE_VIDEOS) {
    throw new Error("youtube_playlist_source_limit_exceeded");
  }
  return [...new Set(rows.map((row) => row.youtube_video_id).filter(Boolean))];
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
  if (items.length === 0) return;
  const placeholders = items.map(() => "(?, ?, ?, ?, 0, ?)").join(", ");
  const values = items.flatMap((item) => [
    eventId,
    item.playlistItemId,
    item.videoId,
    seenAt,
    seenAt,
  ]);
  await env.DB.prepare(
    `INSERT INTO event_youtube_playlist_items (
       event_id, playlist_item_id, youtube_video_id, seen_at,
       managed_by_flamenode, created_at
     ) VALUES ${placeholders}
     ON CONFLICT(event_id, playlist_item_id) DO UPDATE SET
       youtube_video_id = excluded.youtube_video_id,
       seen_at = excluded.seen_at`,
  )
    .bind(...values)
    .run();
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
  now: number,
): Promise<boolean> {
  const scanStartedAt = config.scan_started_at ?? now;
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
    );
    await upsertScannedItems(env, config.event_id, result.items, scanStartedAt);
    pageToken = result.nextPageToken;
    if (!pageToken) {
      await env.DB.prepare(
        `DELETE FROM event_youtube_playlist_items
         WHERE event_id = ?1 AND seen_at <> ?2`,
      )
        .bind(config.event_id, scanStartedAt)
        .run();
      await env.DB.prepare(
        `UPDATE event_youtube_playlist_sync
         SET sync_status = 'idle', last_full_scan_at = ?1,
             scan_started_at = NULL, scan_page_token = NULL,
             next_sync_at = ?1, last_error = NULL, updated_at = ?1
         WHERE event_id = ?2`,
      )
        .bind(now, config.event_id)
        .run();
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
         last_error = ?3, updated_at = ?4
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
  mutationBudget: { remaining: number },
  now: number,
): Promise<"done" | "continued"> {
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
      now,
    );
    if (!scanComplete) return "continued";
  }

  const remoteItems = await loadRemoteItems(env, config.event_id);
  const { additions, removals } = calculateSyncDiff(
    sourceVideoIds,
    remoteItems,
    config.sync_mode,
  );
  let added = 0;
  let removed = 0;

  for (const videoId of additions) {
    if (mutationBudget.remaining <= 0 || !quota.canSpend(50)) break;
    const playlistItemId = await insertPlaylistItem(
      config.playlist_id,
      videoId,
      accessToken,
      quota,
    );
    mutationBudget.remaining -= 1;
    await insertLocalItem(env, config.event_id, playlistItemId, videoId, now);
    added += 1;
  }

  for (const item of removals) {
    if (mutationBudget.remaining <= 0 || !quota.canSpend(50)) break;
    await deletePlaylistItem(item.playlist_item_id, accessToken, quota);
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
      hasRemaining ? "playlist_mutation_batch_continuing" : null,
      now,
      config.event_id,
    )
    .run();
  return hasRemaining ? "continued" : "done";
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
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(env);
  } catch (error) {
    await markOAuthFailure(env, configs, error, now);
    return { processed: 0, skipped: 0, failed: configs.length };
  }

  let processed = 0;
  let failed = 0;
  const mutationBudget = { remaining: MAX_MUTATIONS_PER_RUN };
  try {
    for (const config of configs) {
      try {
        await syncOneEvent(
          env,
          config,
          accessToken,
          quota,
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
  } finally {
    await quota.persist();
  }

  return { processed, skipped: 0, failed };
}
