/** MIG-0513 / MIG-0518 shared viewer overlay client.
 * Private per-viewer data never persists to storage and is not shared between browser sessions.
 * CURRENT: 30s fresh cache, 3s failure cache, 5s timeout, 64-entry LRU.
 */
import React from "react";
import { VideoViewerOverlayResponseSchema, type VideoViewerOverlayDto } from "@flamenode/contracts";

const CHANGE_EVENT = "flamenode:video-viewer-overlay-changed";
const ACTIVE_X_CHANGED_EVENT = "flamenode:active-x-changed";
const FRESH_TTL = 30_000;
const FAILURE_TTL = 3_000;
const TIMEOUT_MS = 5_000;
const MAX_ENTRIES = 64;
type Item = { value?: VideoViewerOverlayDto; at?: number; request?: Promise<VideoViewerOverlayDto> };
const cache = new Map<string, Item>();
function emptyOverlay(authUnavailable = false): VideoViewerOverlayDto {
  return { loggedIn: false, authUnavailable, isBanned: false, isTosAccepted: false,
    termsReacceptRequired: false, activeXId: null, likeActive: false, bookmarkActive: false,
    viewerXApproved: false, privateChapters: [], playlistLabel: "再生リスト", playlistItems: [] };
}
function key(videoId: string, playlist: string): string { return `${videoId}\n${playlist}`; }
function remember(id: string, entry: Item): void {
  cache.delete(id);
  cache.set(id, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}
export function invalidateVideoViewerOverlay(videoId?: string): void {
  if (!videoId) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.startsWith(`${videoId}\n`)) cache.delete(k);
}
export function notifyVideoViewerOverlayChanged(videoId: string): void {
  invalidateVideoViewerOverlay(videoId);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { videoId } }));
}
function pagePlaylist(): string {
  if (typeof window === "undefined") return "";
  try { return (new URLSearchParams(window.location.search).get("playlist") ?? "").trim().slice(0, 128); }
  catch { return ""; }
}
export async function loadVideoViewerOverlay(
  videoId: string, playlist = "", fetcher: typeof fetch = fetch,
): Promise<VideoViewerOverlayDto> {
  const cacheKey = key(videoId, playlist);
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached?.value && cached.at != null && now - cached.at <= (cached.value.authUnavailable ? FAILURE_TTL : FRESH_TTL)) {
    remember(cacheKey, cached); return cached.value;
  }
  if (cached?.request) return cached.request;
  cache.delete(cacheKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const params = playlist ? `?playlist=${encodeURIComponent(playlist)}` : "";
  const request = fetcher(`/api/videos/${encodeURIComponent(videoId)}/viewer-overlay${params}`, {
    credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) return emptyOverlay(true);
    const parsed = VideoViewerOverlayResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : emptyOverlay(true);
  }).catch(() => emptyOverlay(true))
    .then(value => {
      if (cache.get(cacheKey)?.request === request) remember(cacheKey, { value, at: Date.now() });
      return value;
    }).finally(() => clearTimeout(timer));
  remember(cacheKey, { request });
  return request;
}
export function useVideoViewerOverlay(videoId: string, explicitPlaylist?: string): {
  overlay: VideoViewerOverlayDto; loading: boolean; playlist: string; refresh: () => void;
} {
  const [version, setVersion] = React.useState(0);
  const [result, setResult] = React.useState<{ id: string; value: VideoViewerOverlayDto } | null>(null);
  const playlist = explicitPlaylist !== undefined ? explicitPlaylist.trim().slice(0,128) : pagePlaylist();
  const requestId = `${key(videoId, playlist)}\n${version}`;
  const refresh = React.useCallback(() => { invalidateVideoViewerOverlay(videoId); setVersion(n => n + 1); }, [videoId]);
  React.useEffect(() => {
    let current = true;
    void loadVideoViewerOverlay(videoId, playlist).then(value => {
      if (current) setResult({ id: requestId, value });
    });
    return () => { current = false; };
  }, [videoId, playlist, requestId]);
  React.useEffect(() => {
    const changed = (e: Event) => {
      const id = (e as CustomEvent<{ videoId?: string }>).detail?.videoId;
      if (!id || id === videoId) refresh();
    };
    window.addEventListener(CHANGE_EVENT, changed);
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
    return () => { window.removeEventListener(CHANGE_EVENT, changed); window.removeEventListener(ACTIVE_X_CHANGED_EVENT, refresh); };
  }, [videoId, refresh]);
  return { overlay: result?.id === requestId ? result.value : emptyOverlay(), loading: result?.id !== requestId, playlist, refresh };
}
