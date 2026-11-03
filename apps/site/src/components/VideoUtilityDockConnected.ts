import React from "react";
import { useVideoViewerOverlay, notifyVideoViewerOverlayChanged } from "../lib/viewerOverlay.ts";
import { VideoUtilityDockIsland, type PublicVideoChapter } from "./VideoUtilityDockIsland.ts";

/** MIG-0518 U01: share MIG-0513's RH-031 cache/invalidations and query key. */
export function VideoUtilityDockConnected({
  videoId,
  currentId,
  publicChapters,
}: {
  videoId: string;
  currentId: string;
  publicChapters: readonly PublicVideoChapter[];
}): React.ReactElement {
  const { overlay, loading } = useVideoViewerOverlay(videoId);
  return React.createElement(VideoUtilityDockIsland, {
    videoId,
    currentId,
    publicChapters,
    overlay,
    loading,
    onRefresh: () => notifyVideoViewerOverlayChanged(videoId),
  });
}
export default VideoUtilityDockConnected;
