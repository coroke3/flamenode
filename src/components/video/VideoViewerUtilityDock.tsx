"use client";

import * as React from "react";
import { VideoUtilityDock } from "./VideoUtilityDock";
import {
  mergeVideoChapterOverlay,
  type VideoChapterOverlayEntry,
} from "@/lib/publicData/privateVideoChapterOverlay";
import { useVideoViewerOverlay } from "@/lib/video/videoViewerOverlayClient";

function normalizeRuntimePlaylistId(value: unknown): string | undefined {
  const candidate = Array.isArray(value)
    ? value.find((entry): entry is string => typeof entry === "string")
    : value;
  if (typeof candidate !== "string") return undefined;
  const normalized = candidate.trim().slice(0, 128);
  return normalized || undefined;
}

export function VideoViewerUtilityDock({
  videoId,
  currentId,
  playlistId,
  publicChapters,
  loginHref,
  settingsHref,
}: {
  videoId: string;
  currentId: string;
  playlistId?: string;
  publicChapters: VideoChapterOverlayEntry[];
  loginHref: string;
  settingsHref: string;
}): React.ReactElement {
  // App Router searchParamsは重複queryで実行時にstring[]になり得る。
  // Server Component側の型注釈だけを信用せず、client境界でもscalar化する。
  const safePlaylistId = normalizeRuntimePlaylistId(playlistId);
  const { overlay, loading } = useVideoViewerOverlay(videoId, safePlaylistId);
  const chapters = React.useMemo(
    () =>
      mergeVideoChapterOverlay(publicChapters, overlay.privateChapters).map(
        (chapter) => ({
          ...chapter,
          marker_kind: "comment" as const,
        }),
      ),
    [publicChapters, overlay.privateChapters],
  );

  return (
    <VideoUtilityDock
      videoId={videoId}
      currentId={currentId}
      playlistId={safePlaylistId}
      playlistLabel={overlay.playlistLabel}
      playlistItems={overlay.playlistItems}
      chapters={chapters}
      isLoggedIn={overlay.loggedIn}
      authUnavailable={overlay.authUnavailable || loading}
      canPost={
        overlay.viewerXApproved &&
        !overlay.isBanned &&
        !loading &&
        !overlay.authUnavailable
      }
      loginHref={loginHref}
      settingsHref={settingsHref}
      activeXId={overlay.activeXId}
    />
  );
}
