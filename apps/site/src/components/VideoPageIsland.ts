import React from "react";
import { VideoDetailView, type VideoDetailData } from "@flamenode/ui";
import { IslandWrapper } from "./IslandWrapper.ts";
import { VideoPlayer } from "./VideoPlayer.ts";

export interface VideoPageIslandProps {
  video: VideoDetailData;
  youtubeId: string | null;
  primaryEventId: string | null;
  gaEnabled: boolean;
}

/**
 * `/[id]` as one hydrated tree: the server HTML is exactly `VideoDetailView`; hydration swaps in the live player
 * (and the view tracker). Like/save, chapter composer and comments are not here yet: their Hono endpoints are not
 * merged (MIG-0603 B-1..B-5), so the view keeps its static display instead of a control that does nothing.
 */
export function VideoPageIsland({ video, youtubeId, primaryEventId, gaEnabled }: VideoPageIslandProps): React.ReactElement {
  const player = youtubeId
    ? React.createElement(VideoPlayer, { videoId: video.id, youtubeId, title: video.title, primaryEventId, gaEnabled })
    : undefined;
  return React.createElement(IslandWrapper, null, React.createElement(VideoDetailView, { video, player }));
}

export default VideoPageIsland;
