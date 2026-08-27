"use client";

import * as React from "react";
import { VideoUtilityDock } from "./VideoUtilityDock";
import { mergeVideoChapterOverlay, type VideoChapterOverlayEntry } from "@/lib/publicData/privateVideoChapterOverlay";
import { useVideoViewerOverlay } from "@/lib/video/videoViewerOverlayClient";

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
  const { overlay, loading } = useVideoViewerOverlay(videoId, playlistId);
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
      playlistId={playlistId}
      playlistLabel={overlay.playlistLabel}
      playlistItems={overlay.playlistItems}
      chapters={chapters}
      isLoggedIn={overlay.loggedIn}
      authUnavailable={overlay.authUnavailable || loading}
      canPost={overlay.viewerXApproved && !loading && !overlay.authUnavailable}
      loginHref={loginHref}
      settingsHref={settingsHref}
      activeXId={overlay.activeXId}
    />
  );
}
