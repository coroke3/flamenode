import React from "react";
import { VideoDetailView, type VideoDetailData } from "@flamenode/ui";
import { IslandWrapper } from "./IslandWrapper.ts";
import { VideoPlayer } from "./VideoPlayer.ts";
import { VideoInteractionIsland } from "./VideoInteractionIsland.ts";

export interface VideoPageIslandProps {
  video: VideoDetailData;
  youtubeId: string | null;
  primaryEventId: string | null;
  gaEnabled: boolean;
}

/**
 * `/[id]` as one hydrated tree: the server HTML is exactly `VideoDetailView`; hydration swaps in the live player
 * (and the view tracker). MIG-0513 mounts interaction controls after hydration only;
 * SSG/no-JS retains the static count. The POST endpoint is gated on MIG-0640 before cutover.
 */
export function VideoPageIsland({ video, youtubeId, primaryEventId, gaEnabled }: VideoPageIslandProps): React.ReactElement {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  const player = youtubeId
    ? React.createElement(VideoPlayer, { videoId: video.id, youtubeId, title: video.title, primaryEventId, gaEnabled })
    : undefined;
  const interactions = mounted
    ? React.createElement(VideoInteractionIsland, { videoId: video.id, likeCount: video.likeCount ?? 0 })
    : undefined;
  return React.createElement(IslandWrapper, null, React.createElement(VideoDetailView, { video, player, interactions }));
}

export default VideoPageIsland;
