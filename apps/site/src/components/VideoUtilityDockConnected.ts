import React from "react";
import { useVideoViewerOverlay } from "../lib/viewerOverlay.ts";
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
  const { overlay, loading, refresh } = useVideoViewerOverlay(videoId);
  return React.createElement(VideoUtilityDockIsland, {
    videoId,
    currentId,
    publicChapters,
    overlay,
    loading,
    onRefresh: refresh,
  });
}
export default VideoUtilityDockConnected;
