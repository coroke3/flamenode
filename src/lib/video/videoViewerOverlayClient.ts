"use client";

import * as React from "react";
import { ACTIVE_X_CHANGED_EVENT } from "@/lib/client/activeXSwitchEvents";
import type { VideoViewerOverlayDto } from "./videoViewerOverlayCore";

const CACHE_TTL_MS = 30_000;
const FAILURE_CACHE_TTL_MS = 3_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_PRIVATE_CHAPTERS = 500;
const MAX_PLAYLIST_ITEMS = 500;
const VIDEO_VIEWER_OVERLAY_CHANGED_EVENT =
  "flamenode:video-viewer-overlay-changed";

type CacheEntry = {
  value?: VideoViewerOverlayDto;
  fetchedAt?: number;
  ttlMs?: number;
  promise?: Promise<VideoViewerOverlayDto>;
  requestToken?: symbol;
};

type OverlayState = {
  requestKey: string | null;
  value: VideoViewerOverlayDto;
};

type ResolvedPlaylistState = {
  sourceKey: string | null;
  value: string;
};

const cache = new Map<string, CacheEntry>();

function setCacheEntry(key: string, entry: CacheEntry): void {
  // delete+setで最近利用したentryを末尾へ移し、private viewer dataを含む
  // SPA session cacheが未再訪keyで無制限に増え続けないよう上限化する。
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
}

function emptyOverlay(authUnavailable = false): VideoViewerOverlayDto {
  return {
    loggedIn: false,
    authUnavailable,
    isBanned: false,
    isTosAccepted: false,
    termsReacceptRequired: false,
    activeXId: null,
    likeActive: false,
    bookmarkActive: false,
    viewerXApproved: false,
    privateChapters: [],
    playlistLabel: "再生リスト",
    playlistItems: [],
  };
}

function stringOrNull(value: unknown): string | null {
  if (value == null || typeof value !== "string") return null;
  return value;
}

function normalizeOverlay(value: unknown): VideoViewerOverlayDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.loggedIn !== "boolean" ||
    typeof row.authUnavailable !== "boolean" ||
    typeof row.isBanned !== "boolean" ||
    typeof row.isTosAccepted !== "boolean" ||
    typeof row.termsReacceptRequired !== "boolean" ||
    typeof row.likeActive !== "boolean" ||
    typeof row.bookmarkActive !== "boolean" ||
    typeof row.viewerXApproved !== "boolean" ||
    typeof row.playlistLabel !== "string" ||
    !Array.isArray(row.privateChapters) ||
    !Array.isArray(row.playlistItems)
  ) {
    return null;
  }

  const privateChapters = row.privateChapters
    .slice(0, MAX_PRIVATE_CHAPTERS)
    .map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const chapter = value as Record<string, unknown>;
      if (
        typeof chapter.id !== "string" ||
        !Number.isFinite(Number(chapter.chapter_time)) ||
        typeof chapter.chapter_label !== "string" ||
        chapter.visibility !== "private"
      ) {
        return null;
      }
      return {
        id: chapter.id,
        chapter_time: Number(chapter.chapter_time),
        chapter_label: chapter.chapter_label,
        visibility: "private" as const,
        note: stringOrNull(chapter.note),
        author_name: stringOrNull(chapter.author_name),
        author_icon: stringOrNull(chapter.author_icon),
      };
    })
    .filter((chapter): chapter is NonNullable<typeof chapter> => chapter !== null);

  const playlistItems = row.playlistItems
    .slice(0, MAX_PLAYLIST_ITEMS)
    .map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const item = value as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        typeof item.title !== "string" ||
        typeof item.display_name !== "string"
      ) {
        return null;
      }
      return {
        id: item.id,
        title: item.title,
        youtube_video_id: stringOrNull(item.youtube_video_id),
        display_name: item.display_name,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    loggedIn: row.loggedIn,
    authUnavailable: row.authUnavailable,
    isBanned: row.isBanned,
    isTosAccepted: row.isTosAccepted,
    termsReacceptRequired: row.termsReacceptRequired,
    activeXId: stringOrNull(row.activeXId),
    likeActive: row.likeActive,
    bookmarkActive: row.bookmarkActive,
    viewerXApproved: row.viewerXApproved,
    privateChapters,
    playlistLabel: row.playlistLabel,
    playlistItems,
  };
}

function normalizePlaylistValue(value: string): string {
  return value.trim().slice(0, 128);
}

function resolvePlaylist(explicitPlaylist?: string): string {
  if (explicitPlaylist !== undefined) {
    return normalizePlaylistValue(explicitPlaylist);
  }
  try {
    return normalizePlaylistValue(
      new URLSearchParams(window.location.search).get("playlist") ?? "",
    );
  } catch {
    return "";
  }
}

function playlistSourceKey(videoId: string, explicitPlaylist?: string): string {
  return explicitPlaylist === undefined
    ? `implicit:${videoId}`
    : `explicit:${normalizePlaylistValue(explicitPlaylist)}`;
}

function overlayKey(videoId: string, playlist: string): string {
  return `${videoId}\n${playlist}`;
}

async function fetchOverlay(
  videoId: string,
  playlist: string,
): Promise<VideoViewerOverlayDto> {
  const key = overlayKey(videoId, playlist);
  const now = Date.now();
  const existing = cache.get(key);
  if (
    existing?.value &&
    existing.fetchedAt != null &&
    now - existing.fetchedAt <= (existing.ttlMs ?? CACHE_TTL_MS)
  ) {
    setCacheEntry(key, existing);
    return existing.value;
  }
  if (existing?.promise) {
    setCacheEntry(key, existing);
    return existing.promise;
  }

  // 期限切れentryは新requestの前に破棄し、古いprivate payloadを保持し続けない。
  if (existing) cache.delete(key);

  const params = new URLSearchParams();
  if (playlist) params.set("playlist", playlist);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const requestToken = Symbol(key);
  const promise = fetch(
    `/api/videos/${encodeURIComponent(videoId)}/viewer-overlay${suffix}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  )
    .then(async (response) => {
      // 404もSSR後の非公開化/削除raceを含む。未ログイン扱いへ落とすと
      // 操作可能に見える誤表示になるため、全non-OKをfail-closedにする。
      if (!response.ok) return emptyOverlay(true);
      const normalized = normalizeOverlay(await response.json());
      return normalized ?? emptyOverlay(true);
    })
    .catch(() => emptyOverlay(true))
    .then((value) => {
      if (cache.get(key)?.requestToken === requestToken) {
        setCacheEntry(key, {
          value,
          fetchedAt: Date.now(),
          // 一時障害だけはAPIのRetry-After(3s)と同程度で再試行可能にする。
          // 正常viewer情報と同じ30秒保持すると、復旧後も失敗状態を再利用してしまう。
          ttlMs: value.authUnavailable ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS,
        });
      }
      return value;
    });

  setCacheEntry(key, { promise, requestToken });
  return promise;
}

export function invalidateVideoViewerOverlay(videoId?: string): void {
  if (!videoId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${videoId}\n`)) cache.delete(key);
  }
}

/**
 * viewer依存の書込後に、同じページでmount中のinteraction / utility dockを同期する。
 * full RSC refreshは行わず、各hookは同一in-flight overlay requestを共有する。
 */
export function notifyVideoViewerOverlayChanged(videoId: string): void {
  invalidateVideoViewerOverlay(videoId);
  window.dispatchEvent(
    new CustomEvent(VIDEO_VIEWER_OVERLAY_CHANGED_EVENT, {
      detail: { videoId },
    }),
  );
}

export function useVideoViewerOverlay(
  videoId: string,
  explicitPlaylist?: string,
): { overlay: VideoViewerOverlayDto; loading: boolean; refresh: () => void } {
  const sourceKey = playlistSourceKey(videoId, explicitPlaylist);
  const [playlistState, setPlaylistState] = React.useState<ResolvedPlaylistState>(
    () =>
      explicitPlaylist === undefined
        ? { sourceKey: null, value: "" }
        : {
            sourceKey,
            value: normalizePlaylistValue(explicitPlaylist),
          },
  );
  const [overlayState, setOverlayState] = React.useState<OverlayState>(() => ({
    requestKey: null,
    value: emptyOverlay(),
  }));
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    setPlaylistState({
      sourceKey,
      value: resolvePlaylist(explicitPlaylist),
    });
  }, [explicitPlaylist, sourceKey]);

  React.useEffect(() => {
    const refresh = () => {
      invalidateVideoViewerOverlay(videoId);
      setNonce((value) => value + 1);
    };
    const onOverlayChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ videoId?: string }>).detail;
      if (detail?.videoId && detail.videoId !== videoId) return;
      refresh();
    };
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
    window.addEventListener(
      VIDEO_VIEWER_OVERLAY_CHANGED_EVENT,
      onOverlayChanged,
    );
    return () => {
      window.removeEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
      window.removeEventListener(
        VIDEO_VIEWER_OVERLAY_CHANGED_EVENT,
        onOverlayChanged,
      );
    };
  }, [videoId]);

  const playlistReady = playlistState.sourceKey === sourceKey;
  const playlist = playlistReady ? playlistState.value : "";
  const currentRequestKey = playlistReady
    ? `${overlayKey(videoId, playlist)}\n${sourceKey}\n${nonce}`
    : null;

  React.useEffect(() => {
    if (!playlistReady) return;
    let active = true;
    const requestKey = `${overlayKey(videoId, playlist)}\n${sourceKey}\n${nonce}`;
    setLoading(true);
    void fetchOverlay(videoId, playlist).then((value) => {
      if (!active) return;
      setOverlayState({ requestKey, value });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [videoId, playlist, playlistReady, sourceKey, nonce]);

  const overlayIsCurrent =
    currentRequestKey !== null && overlayState.requestKey === currentRequestKey;

  return {
    // video/playlist/sourceが切り替わったrenderでは旧viewer情報を返さない。
    // private chapter / library playlist / interaction stateをfail-closedにする。
    overlay: overlayIsCurrent ? overlayState.value : emptyOverlay(),
    loading: loading || !overlayIsCurrent,
    refresh: () => {
      invalidateVideoViewerOverlay(videoId);
      setNonce((value) => value + 1);
    },
  };
}
