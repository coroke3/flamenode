"use client";

import * as React from "react";
import { VideoUtilityDock } from "./VideoUtilityDock";
import {
  mergeVideoChapterOverlay,
  type VideoChapterOverlayEntry,
} from "@/lib/publicData/privateVideoChapterOverlay";
import { useVideoViewerOverlay } from "@/lib/video/videoViewerOverlayClient";

export function VideoViewerUtilityDock({
  videoId,
  currentId,
  publicChapters,
  loginHref,
  settingsHref,
}: {
  videoId: string;
  currentId: string;
  publicChapters: VideoChapterOverlayEntry[];
  loginHref: string;
  settingsHref: string;
}): React.ReactElement {
  // The page is served from the ISR cache, so `?playlist=` is read in the
  // browser (first value only) by the overlay hook rather than passed down.
  const { overlay, loading, playlist } = useVideoViewerOverlay(videoId);
  const needsTermsAcceptance =
    overlay.loggedIn &&
    (!overlay.isTosAccepted || overlay.termsReacceptRequired);
  const rulesHref = `/rules?next=${encodeURIComponent(`/${currentId}`)}`;
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
      playlistId={playlist || undefined}
      playlistLabel={overlay.playlistLabel}
      playlistItems={overlay.playlistItems}
      chapters={chapters}
      isLoggedIn={overlay.loggedIn}
      authUnavailable={overlay.authUnavailable || loading}
      needsTermsAcceptance={needsTermsAcceptance}
      canPost={
        overlay.viewerXApproved &&
        !overlay.isBanned &&
        !needsTermsAcceptance &&
        !loading &&
        !overlay.authUnavailable
      }
      loginHref={loginHref}
      rulesHref={rulesHref}
      settingsHref={settingsHref}
      activeXId={overlay.activeXId}
    />
  );
}
