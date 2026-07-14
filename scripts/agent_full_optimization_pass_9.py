from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


# ---------------------------------------------------------------------------
# Public JSON: allow already-serialized bodies so large cached exports are not
# parsed and stringified again.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/api/publicApi.ts",
    '''export async function publicJsonResponse(
  request: Request,
  payload: unknown,
  cacheControl: string,
  status = 200,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const etag = await bodyEtag(body);
  const headers = { "Cache-Control": cacheControl, ETag: etag };
  if (status === 200 && etagMatches(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
''',
    '''export async function publicJsonBodyResponse(
  request: Request,
  body: string,
  cacheControl: string,
  status = 200,
): Promise<Response> {
  const etag = await bodyEtag(body);
  const headers = { "Cache-Control": cacheControl, ETag: etag };
  if (status === 200 && etagMatches(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export function publicJsonResponse(
  request: Request,
  payload: unknown,
  cacheControl: string,
  status = 200,
): Promise<Response> {
  return publicJsonBodyResponse(
    request,
    JSON.stringify(payload),
    cacheControl,
    status,
  );
}
''',
)

# ---------------------------------------------------------------------------
# Event export cache: reuse validated Cloudflare env binding and avoid opening
# nine KV writes simultaneously during invalidation.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/api/eventExportCache.ts",
    '''function isKvNamespace(value: unknown): value is KVNamespace {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { get?: unknown }).get === "function" &&
    typeof (value as { put?: unknown }).put === "function" &&
    typeof (value as { delete?: unknown }).delete === "function"
  );
}

export function getEventExportKv(): KVNamespace | null {
  const kv = getEnv().KV;
  return isKvNamespace(kv) ? kv : null;
}
''',
    '''export function getEventExportKv(): KVNamespace | null {
  return getEnv().KV ?? null;
}
''',
)
replace_once(
    "src/lib/api/eventExportCache.ts",
    '''  const results = await Promise.allSettled(keys.map((key) => kv.delete(key)));
  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length > 0) {
    console.warn("[event-export-api] cache invalidation partially failed", {
      eventId,
      failed: rejected.length,
    });
  }
''',
    '''  let failed = 0;
  for (let offset = 0; offset < keys.length; offset += 6) {
    const results = await Promise.allSettled(
      keys.slice(offset, offset + 6).map((key) => kv.delete(key)),
    );
    failed += results.filter((result) => result.status === "rejected").length;
  }
  if (failed > 0) {
    console.warn("[event-export-api] cache invalidation partially failed", {
      eventId,
      failed,
    });
  }
''',
)

# ---------------------------------------------------------------------------
# Event export route: keep cached/generated payload serialized end-to-end.
# Corrupt JSON is still detected and evicted, while KV read failures no longer
# trigger an unnecessary delete request.
# ---------------------------------------------------------------------------
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''  EVENT_EXPORT_ACCESS_TTL_SECONDS,
  eventExportAccessCacheKey,
''',
    '''  EVENT_EXPORT_ACCESS_TTL_SECONDS,
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportAccessCacheKey,
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''import { checkPublicApiRateLimit, publicJsonResponse } from "@/lib/api/publicApi";

const inFlightExports = new Map<string, Promise<unknown | null>>();
''',
    '''import {
  checkPublicApiRateLimit,
  publicJsonBodyResponse,
  publicJsonResponse,
} from "@/lib/api/publicApi";

const inFlightExports = new Map<string, Promise<string | null>>();
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''  payload: unknown,
''',
    '''  body: string,
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''  const response = await publicJsonResponse(req, payload, cacheControl);
''',
    '''  const response = await publicJsonBodyResponse(req, body, cacheControl);
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''async function readCachedPayload(
  kv: KVNamespace,
  cacheKey: string,
  eventId: string,
): Promise<unknown | null> {
  try {
    const cached = await kv.get(cacheKey);
    if (!cached) return null;
    return JSON.parse(cached) as unknown;
  } catch (error) {
    console.warn("[event-export-api] KV payload read failed", {
      eventId,
      cacheKey,
      error,
    });
    try {
      await kv.delete(cacheKey);
    } catch {
      // 壊れたキャッシュ削除の失敗はD1フォールバックを妨げない。
    }
    return null;
  }
}
''',
    '''async function readCachedPayload(
  kv: KVNamespace,
  cacheKey: string,
  eventId: string,
): Promise<string | null> {
  let cached: string | null;
  try {
    cached = await kv.get(cacheKey);
  } catch (error) {
    console.warn("[event-export-api] KV payload read failed", {
      eventId,
      cacheKey,
      error,
    });
    return null;
  }
  if (!cached) return null;
  try {
    JSON.parse(cached);
    return cached;
  } catch (error) {
    console.warn("[event-export-api] invalid KV payload evicted", {
      eventId,
      cacheKey,
      error,
    });
    try {
      await kv.delete(cacheKey);
    } catch {
      // 壊れたキャッシュ削除の失敗はD1フォールバックを妨げない。
    }
    return null;
  }
}
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''async function buildPayloadOnce(
  key: string,
  factory: () => Promise<unknown | null>,
): Promise<unknown | null> {
''',
    '''async function buildPayloadOnce(
  key: string,
  factory: () => Promise<string | null>,
): Promise<string | null> {
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''          refresh: [15, 60, 360, 1440],
''',
    '''          refresh: EVENT_EXPORT_REFRESH_MINUTES,
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''  const payload = await buildPayloadOnce(
    [eventId, format, updateMode].join(":"),
    async () => {
      const snapshot = await loadEventExportSnapshot(db, eventId, prefetchedEvent);
      return snapshot
        ? buildEventExportPayloadForFormat(
            snapshot,
            format,
            generatedAt,
            updateMode,
          )
        : null;
    },
  );

  if (payload === null) {
''',
    '''  const body = await buildPayloadOnce(
    [eventId, format, updateMode].join(":"),
    async () => {
      const snapshot = await loadEventExportSnapshot(db, eventId, prefetchedEvent);
      return snapshot
        ? JSON.stringify(
            buildEventExportPayloadForFormat(
              snapshot,
              format,
              generatedAt,
              updateMode,
            ),
          )
        : null;
    },
  );

  if (body === null) {
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''      kv.put(payloadCacheKey, JSON.stringify(payload), {
''',
    '''      kv.put(payloadCacheKey, body, {
''',
)
replace_once(
    "app/api/event-endpoints/[id]/route.ts",
    '''    payload,
    format,
''',
    '''    body,
    format,
''',
)

# ---------------------------------------------------------------------------
# YouTube playlist sync: use shared bounded fetch, cache OAuth tokens within an
# isolate, request partial responses, deduplicate in SQL, batch D1 writes, and
# remove ignored/no-op control flow.
# ---------------------------------------------------------------------------
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''} from "../youtube-sync/quotaBudget.ts";

export interface PlaylistSyncEnv extends YoutubeQuotaEnv {
''',
    '''} from "../youtube-sync/quotaBudget.ts";
import {
  cancelResponseBody,
  ExternalRequestBudget,
  fetchWithTimeout,
} from "../shared/externalApi.ts";

export interface PlaylistSyncEnv extends YoutubeQuotaEnv {
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''const API_TIMEOUT_MS = 10_000;
''',
    '''const API_TIMEOUT_MS = 10_000;
/** OAuth 1 + scan 3 + insertion fallback込みmutation 8。 */
const MAX_EXTERNAL_REQUESTS_PER_RUN = 12;
const OAUTH_TOKEN_SAFETY_MS = 60_000;
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  async persist(): Promise<void> {
    // 各API呼び出し直前にD1へ原子的に予約するため追加保存は不要。
  }
''',
    '''''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''async function fetchWithTimeout(
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

''',
    '''''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  } catch {
    // API本文をログやDBへ保存しない。
  }
''',
    '''  } catch {
    await cancelResponseBody(response);
    // API本文をログやDBへ保存しない。
  }
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''async function refreshAccessToken(env: PlaylistSyncEnv): Promise<string> {
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
''',
    '''type CachedAccessToken = { value: string; expiresAt: number };
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
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''async function youtubeJson<T>(
  url: URL,
  init: RequestInit,
  accessToken: string,
  quota: DailyQuotaBudget,
  cost: number,
): Promise<T> {
  await quota.spend(cost);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetchWithTimeout(url.toString(), {
    ...init,
    headers,
  });
  if (!response.ok) throw await readApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
''',
    '''async function youtubeJson<T>(
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
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''async function listPlaylistPage(
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
''',
    '''async function listPlaylistPage(
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
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''async function postPlaylistItem(
  playlistId: string,
  videoId: string,
  position: number | null,
  accessToken: string,
  quota: DailyQuotaBudget,
): Promise<string> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
''',
    '''async function postPlaylistItem(
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
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''    accessToken,
    quota,
    50,
  );
''',
    '''    accessToken,
    quota,
    requestBudget,
    50,
  );
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''async function insertPlaylistItem(
  playlistId: string,
  videoId: string,
  position: number,
  accessToken: string,
  quota: DailyQuotaBudget,
): Promise<InsertedPlaylistItem> {
''',
    '''async function insertPlaylistItem(
  playlistId: string,
  videoId: string,
  position: number,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
): Promise<InsertedPlaylistItem> {
''',
)
# Both ordered and fallback post calls have the same tail.
playlist_path = Path("workers/youtube-playlist-sync/index.ts")
playlist_source = playlist_path.read_text(encoding="utf-8")
old_tail = '''        accessToken,
        quota,
      ),'''
if playlist_source.count(old_tail) != 2:
    raise RuntimeError("youtube playlist: expected two postPlaylistItem tails")
playlist_path.write_text(
    playlist_source.replace(
        old_tail,
        '''        accessToken,
        quota,
        requestBudget,
      ),''',
    ),
    encoding="utf-8",
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''async function deletePlaylistItem(
  playlistItemId: string,
  accessToken: string,
  quota: DailyQuotaBudget,
): Promise<void> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("id", playlistItemId);
''',
    '''async function deletePlaylistItem(
  playlistItemId: string,
  accessToken: string,
  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
): Promise<void> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("id", playlistItemId);
  url.searchParams.set("prettyPrint", "false");
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''      accessToken,
      quota,
      50,
    );
''',
    '''      accessToken,
      quota,
      requestBudget,
      50,
    );
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''     ORDER BY COALESCE(v.scheduled_time, v.created_at), v.id
     LIMIT ?2`,
''',
    '''     GROUP BY v.youtube_video_id
     ORDER BY MIN(COALESCE(v.scheduled_time, v.created_at)), MIN(v.id)
     LIMIT ?2`,
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  return [...new Set(rows.map((row) => row.youtube_video_id).filter(Boolean))];
''',
    '''  return rows.map((row) => row.youtube_video_id);
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  for (let offset = 0; offset < items.length; offset += SCAN_UPSERT_CHUNK_SIZE) {
    const chunk = items.slice(offset, offset + SCAN_UPSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, 0, ?)").join(", ");
    const values = chunk.flatMap((item) => [
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
''',
    '''  const statements: D1PreparedStatement[] = [];
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
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  quota: DailyQuotaBudget,
  now: number,
): Promise<boolean> {
''',
    '''  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  now: number,
): Promise<boolean> {
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''      accessToken,
      quota,
    );
''',
    '''      accessToken,
      quota,
      requestBudget,
    );
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''      await env.DB.prepare(
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
''',
    '''      await env.DB.batch([
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
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  quota: DailyQuotaBudget,
  mutationBudget: { remaining: number },
  now: number,
): Promise<"done" | "continued"> {
''',
    '''  quota: DailyQuotaBudget,
  requestBudget: ExternalRequestBudget,
  mutationBudget: { remaining: number },
  now: number,
): Promise<void> {
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''      quota,
      now,
    );
    if (!scanComplete) return "continued";
''',
    '''      quota,
      requestBudget,
      now,
    );
    if (!scanComplete) return;
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  let added = 0;
  let removed = 0;
  let orderFallback = false;

  for (const videoId of additions) {
''',
    '''  let added = 0;
  let removed = 0;
  let orderFallback = false;
  const sourcePositions = new Map(
    sourceVideoIds.map((videoId, index) => [videoId, index]),
  );

  for (const videoId of additions) {
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''    const position = sourceVideoIds.indexOf(videoId);
''',
    '''    const position = sourcePositions.get(videoId) ?? 0;
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''      accessToken,
      quota,
    );
''',
    '''      accessToken,
      quota,
      requestBudget,
    );
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''    await deletePlaylistItem(item.playlist_item_id, accessToken, quota);
''',
    '''    await deletePlaylistItem(
      item.playlist_item_id,
      accessToken,
      quota,
      requestBudget,
    );
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  return hasRemaining ? "continued" : "done";
''',
    '''  return;
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  const quota = await DailyQuotaBudget.load(env, now);
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(env);
''',
    '''  const quota = await DailyQuotaBudget.load(env, now);
  const requestBudget = new ExternalRequestBudget(MAX_EXTERNAL_REQUESTS_PER_RUN);
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(env, requestBudget);
''',
)
replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''  try {
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
''',
    '''  for (const config of configs) {
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
''',
)

# ---------------------------------------------------------------------------
# Playlist tests: preserve behavior tests and lock in the structural reductions.
# ---------------------------------------------------------------------------
Path("workers/youtube-playlist-sync/index.test.mjs").write_text(
    '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateSyncDiff } from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const remote = [
  { playlist_item_id: "item-a", youtube_video_id: "video-a" },
  { playlist_item_id: "item-old", youtube_video_id: "video-old" },
];

test("worker module loads in Node strip-only mode", () => {
  assert.equal(typeof calculateSyncDiff, "function");
});

test("append_only adds missing videos without deleting remote items", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "append_only");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, []);
});

test("missing videos preserve source schedule order", () => {
  const diff = calculateSyncDiff(
    ["video-first", "video-a", "video-middle", "video-last"],
    remote,
    "append_only",
  );
  assert.deepEqual(diff.additions, [
    "video-first",
    "video-middle",
    "video-last",
  ]);
});

test("mirror adds missing videos and removes videos outside the event", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "mirror");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, [remote[1]]);
});

test("playlist外部呼出しは共通timeoutと固定予算を使う", () => {
  assert.match(source, /from "\.\.\/shared\/externalApi\.ts"/);
  assert.match(source, /MAX_EXTERNAL_REQUESTS_PER_RUN = 12/);
  assert.match(source, /new ExternalRequestBudget\(MAX_EXTERNAL_REQUESTS_PER_RUN\)/);
  assert.doesNotMatch(source, /async function fetchWithTimeout/);
});

test("OAuth tokenをisolate内で期限付き再利用し401で破棄する", () => {
  assert.match(source, /__flamenodeYoutubePlaylistAccessToken/);
  assert.match(source, /OAUTH_TOKEN_SAFETY_MS/);
  assert.match(source, /response\.status === 401/);
  assert.match(source, /clearCachedAccessToken\(\)/);
});

test("playlist APIはpartial responseとcompact JSONを使う", () => {
  assert.match(source, /nextPageToken,items\(id,snippet\/resourceId\/videoId\)/);
  assert.match(source, /url\.searchParams\.set\("fields", "id"\)/);
  assert.ok((source.match(/prettyPrint/g) ?? []).length >= 3);
});

test("source重複排除とD1保存はDB側でまとめる", () => {
  assert.match(source, /GROUP BY v\.youtube_video_id/);
  assert.doesNotMatch(source, /new Set\(rows\.map/);
  assert.match(source, /env\.DB\.batch\(statements\)/);
  assert.match(source, /DELETE FROM event_youtube_playlist_items[\s\S]*env\.DB\.batch/);
});

test("無効な制御処理と線形indexOfを残さない", () => {
  assert.doesNotMatch(source, /async persist\(\)/);
  assert.doesNotMatch(source, /quota\.persist\(\)/);
  assert.doesNotMatch(source, /sourceVideoIds\.indexOf/);
  assert.match(source, /const sourcePositions = new Map/);
});
''',
    encoding="utf-8",
)

# ---------------------------------------------------------------------------
# Notification dispatcher: remove obsolete barrel and consolidate three test
# files into the implementation's single test file.
# ---------------------------------------------------------------------------
Path("workers/notification-dispatcher/dispatch.test.mjs").write_text(
    '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  deliver,
  MAX_DISCORD_DM_KV_WRITES_PER_RUN,
  MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN,
  MAX_NOTIFICATION_BATCH,
  processNotificationQueue,
} from "./dispatch.ts";

function okJson(value = {}, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("notification dispatcher uses recipient_user_id and bounded lease-aware selection", async () => {
  const statements = [];
  const env = {
    DB: {
      prepare(sql) {
        statements.push(sql);
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    },
  };
  const result = await processNotificationQueue(env, { limit: 999 });
  assert.deepEqual(result, { processed: 0, failed: 0, skipped: 0 });
  const sql = statements.join("\n");
  assert.match(sql, /recipient_user_id/);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /dead_letter/);
  assert.match(sql, /COALESCE\(attempt_count, 0\)/);
  assert.match(sql, /lease_expires_at <= \?1/);
  assert.match(sql, /LIMIT \?3/);
  assert.equal(MAX_NOTIFICATION_BATCH, 6);
  assert.equal(MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN, 12);
  assert.equal(MAX_DISCORD_DM_KV_WRITES_PER_RUN, 2);
});

test("deliver: generic notification types use Discord DM when bot token exists", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/users/@me/channels")) {
      return okJson({ id: "dm_channel" });
    }
    return okJson();
  };
  try {
    const ok = await deliver(
      {
        type: "announcement_broadcast",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "123456789012345678",
      },
      { DISCORD_BOT_TOKEN: "bot-token" },
    );
    assert.equal(ok, true);
    assert.equal(calls.length, 2);
    assert.equal(
      JSON.parse(String(calls[0].init.body)).recipient_id,
      "123456789012345678",
    );
    assert.match(calls[1].url, /\/channels\/dm_channel\/messages$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: 同一recipientのDM channelを再利用して2回目を1 requestにする", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/users/@me/channels")) {
      return okJson({ id: "reused_channel" });
    }
    return okJson();
  };
  const row = {
    type: "announcement_broadcast",
    payload_json: JSON.stringify({ content: "hello" }),
    discord_id: "223456789012345678",
  };
  try {
    assert.equal(await deliver(row, { DISCORD_BOT_TOKEN: "bot-token" }), true);
    assert.equal(await deliver(row, { DISCORD_BOT_TOKEN: "bot-token" }), true);
    assert.equal(calls.filter((url) => url.endsWith("/users/@me/channels")).length, 1);
    assert.equal(calls.filter((url) => url.endsWith("/messages")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: Discord 429はRetry-Afterを読んでinline retryしない", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ retry_after: 12.5, global: false }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "12.5",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset-after": "12.5",
      },
    });
  };
  try {
    const ok = await deliver(
      {
        type: "discord_webhook",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "",
      },
      { DISCORD_WEBHOOK_URL: "https://example.test/rate-limited" },
    );
    assert.equal(ok, false);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: discord_webhook without webhook URL does not fall back to DM", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return okJson();
  };
  try {
    const ok = await deliver(
      {
        type: "discord_webhook",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "123456789012345678",
      },
      { DISCORD_BOT_TOKEN: "bot-token" },
    );
    assert.equal(ok, false);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: discord_webhook uses webhook URL when configured", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return okJson();
  };
  try {
    const ok = await deliver(
      {
        type: "discord_webhook",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "123456789012345678",
      },
      {
        DISCORD_WEBHOOK_URL: "https://example.test/webhook",
        DISCORD_BOT_TOKEN: "bot-token",
      },
    );
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.test/webhook");
    assert.equal(calls[0].init.body, JSON.stringify({ content: "hello" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Discord route cooldownはglobal cooldownも横断確認する", async () => {
  const source = await readFile(new URL("./dispatch.ts", import.meta.url), "utf8");
  assert.match(source, /DISCORD_GLOBAL_COOLDOWN_KEY = "discord:global"/);
  assert.match(
    source,
    /activeCooldownUntil\(DISCORD_GLOBAL_COOLDOWN_KEY, now\)/,
  );
  assert.match(source, /x-ratelimit-global/);
  assert.match(source, /x-ratelimit-scope/);
  assert.match(source, /body\.global === true/);
});

test("Discord 429はinline retryせず次回実行へ繰り越す", async () => {
  const source = await readFile(new URL("./dispatch.ts", import.meta.url), "utf8");
  const failureSection = source.slice(
    source.indexOf("async function discordFailure"),
    source.indexOf("async function recoverExpiredLeases"),
  );
  assert.match(failureSection, /retryAfterSeconds/);
  assert.doesNotMatch(failureSection, /await delay/);
  assert.doesNotMatch(failureSection, /for \(let attempt/);
});
''',
    encoding="utf-8",
)
for obsolete in (
    "workers/notification-dispatcher/index.ts",
    "workers/notification-dispatcher/index.test.mjs",
    "workers/notification-dispatcher/rateLimit.test.mjs",
):
    Path(obsolete).unlink()

# ---------------------------------------------------------------------------
# Contract tests and operations docs.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/eventExportPayload.test.mjs",
    '''  assert.match(route, /s-maxage=60/);
});
''',
    '''  assert.match(route, /s-maxage=60/);
  assert.match(route, /publicJsonBodyResponse/);
  assert.match(route, /kv\.put\(payloadCacheKey, body/);
  assert.doesNotMatch(route, /kv\.put\(payloadCacheKey, JSON\.stringify/);
});
''',
)
replace_once(
    "docs/operations/external-api-limits.md",
    '''> Source of truth: `workers/shared/externalApi.ts`、`workers/youtube-sync/index.ts`、`workers/notification-dispatcher/dispatch.ts`、`src/lib/media/externalImageProxy.ts`
''',
    '''> Source of truth: `workers/shared/externalApi.ts`、`workers/youtube-sync/index.ts`、`workers/youtube-playlist-sync/index.ts`、`workers/notification-dispatcher/dispatch.ts`、`src/lib/media/externalImageProxy.ts`
''',
)
replace_once(
    "docs/operations/external-api-limits.md",
    '''| YouTube Data API `videos.list` | 50 ID、通常1 request、最大2 quota units | 429/5xxは最大1回retry。quota系403はKVへ1時間cooldown | `fields`で必要列だけ取得。期限到来50件だけ選択 |
''',
    '''| YouTube Data API `videos.list` | 50 ID、通常1 request、最大2 quota units | 429/5xxは最大1回retry。quota系403はKVへ1時間cooldown | `fields`で必要列だけ取得。期限到来50件だけ選択 |
| YouTube playlist / OAuth | 1実行最大12 external requests、mutation最大4 | quota予約後に実行。401時はtoken cacheを破棄し次回Cronで再取得 | OAuth tokenをisolate内で期限付き再利用。playlist responseは`fields`で縮小 |
''',
)
replace_once(
    "docs/operations/external-api-limits.md",
    '''- APIキー、quota error本文、URL queryをログへ出さない。

### Discord
''',
    '''- APIキー、quota error本文、URL queryをログへ出さない。
- 再生リスト同期はOAuth access tokenをisolate内で期限付き再利用し、Cronごとのtoken endpoint呼出しを避ける。
- 再生リスト一覧・追加はpartial responseを使用し、1実行の外部requestを最大12に固定する。

### Discord
''',
)
replace_once(
    "docs/workers.md",
    '''- この台帳は将来の再生リスト同期など高quota処理とも共有する。日次上限まで無意味なrequestを発生させるものではなく、必要な処理がある場合だけ最大80%まで使用できる設計とする。
''',
    '''- この台帳は再生リスト同期の高quota処理とも共有する。日次上限まで無意味なrequestを発生させるものではなく、必要な処理がある場合だけ最大80%まで使用できる設計とする。
- 再生リスト同期はOAuth tokenをisolate内で期限付き再利用し、一覧取得はpartial response、D1保存はbatchで処理する。1実行の外部requestは最大12に固定する。
''',
)

# Remove the one-shot patcher and its workflow before committing the actual diff.
Path("scripts/agent_full_optimization_pass_9.py").unlink()
Path(".github/workflows/agent-full-optimization-pass-9.yml").unlink()
print("full optimization pass 9 applied")
