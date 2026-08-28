"use client";

import * as React from "react";
import { ACTIVE_X_CHANGED_EVENT } from "@/lib/client/activeXSwitchEvents";
import type { VideoViewerOverlayDto } from "./videoViewerOverlayCore";

const CACHE_TTL_MS = 30_000;
const MAX_PRIVATE_CHAPTERS = 500;
const MAX_PLAYLIST_ITEMS = 500;
const VIDEO_VIEWER_OVERLAY_CHANGED_EVENT =
  "flamenode:video-viewer-overlay-changed";

type CacheEntry = {
  value?: VideoViewerOverlayDto;
  fetchedAt?: number;
  promise?: Promise<VideoViewerOverlayDto>;
};

const cache = new Map<string, CacheEntry>();

function emptyOverlay(authUnavailable = false): VideoViewerOverlayDto {
  return {
    loggedIn: false,
    authUnavailable,
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

function resolvePlaylist(explicitPlaylist?: string): string {
  if (explicitPlaylist !== undefined) return explicitPlaylist.trim().slice(0, 128);
  try {
    return (new URLSearchParams(window.location.search).get("playlist") ?? "")
      .trim()
      .slice(0, 128);
  } catch {
    return "";
  }
}

function overlayKey(videoId: string, playlist: string): string {
  return `${videoId}\n${playlist}`;
}

async function fetchOverlay(
  videoId: string,
  playlist: string,
  force = false,
): Promise<VideoViewerOverlayDto> {
  const key = overlayKey(videoId, playlist);
  const now = Date.now();
  const existing = cache.get(key);
  if (
    !force &&
    existing?.value &&
    existing.fetchedAt != null &&
    now - existing.fetchedAt <= CACHE_TTL_MS
  ) {
    return existing.value;
  }
  // force refreshでも同一keyのin-flightは共有する。複数islandが同じ更新
  // eventを受けてもviewer API requestを重複させない。
  if (existing?.promise) return existing.promise;

  const params = new URLSearchParams();
  if (playlist) params.set("playlist", playlist);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const promise = fetch(
    `/api/videos/${encodeURIComponent(videoId)}/viewer-overlay${suffix}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  )
    .then(async (response) => {
      if (!response.ok) return emptyOverlay(response.status >= 500);
      const normalized = normalizeOverlay(await response.json());
      return normalized ?? emptyOverlay(true);
    })
    .catch(() => emptyOverlay(true))
    .then((value) => {
      cache.set(key, { value, fetchedAt: Date.now() });
      return value;
    });

  cache.set(key, { ...existing, promise });
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
  const explicit = explicitPlaylist !== undefined;
  const [playlist, setPlaylist] = React.useState(
    explicit ? explicitPlaylist.trim().slice(0, 128) : "",
  );
  const [playlistReady, setPlaylistReady] = React.useState(explicit);
  const [overlay, setOverlay] = React.useState<VideoViewerOverlayDto>(() => emptyOverlay());
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    setPlaylist(resolvePlaylist(explicitPlaylist));
    setPlaylistReady(true);
  }, [explicitPlaylist]);

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

  React.useEffect(() => {
    if (!playlistReady) return;
    let active = true;
    setLoading(true);
    void fetchOverlay(videoId, playlist, nonce > 0).then((value) => {
      if (!active) return;
      setOverlay(value);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [videoId, playlist, playlistReady, nonce]);

  return {
    overlay,
    loading,
    refresh: () => {
      invalidateVideoViewerOverlay(videoId);
      setNonce((value) => value + 1);
    },
  };
}
