import React from "react";
import { useVideoViewerOverlay, notifyVideoViewerOverlayChanged } from "../lib/viewerOverlay.ts";
import { VideoUtilityDockIsland, type PublicVideoChapter } from "./VideoUtilityDockIsland.ts";
import type { EditableChapter } from "./VideoChapterIsland.ts";
import type { VideoViewerOverlayDto } from "@flamenode/contracts";
import { formatChapterTime } from "../../../../packages/domain/src/video/chapterTime.ts";

/**
 * MIG-0518: consume server-calculated RH-031 admin and per-row management claims.
 * MIG-0634 follow-up #662 introduces the optional field. Until the contract
 * lands and the parsed overlay contains explicit true claims, management stays disabled.
 */
export function chapterManagementForOverlay(
  publicChapters: readonly PublicVideoChapter[],
  overlay: VideoViewerOverlayDto,
  loading: boolean,
): { canBulk: boolean; editableChapters: EditableChapter[] } {
  const perRowOverlay = overlay as VideoViewerOverlayDto & {
    viewerCanEditChapters?: boolean;
    privateChapters: Array<VideoViewerOverlayDto["privateChapters"][number] & {
      viewerCanManage?: boolean;
    }>;
  };
  const authorized = !loading && overlay.loggedIn &&
    !overlay.authUnavailable && !overlay.isBanned &&
    overlay.isTosAccepted && !overlay.termsReacceptRequired &&
    overlay.viewerXApproved && Boolean(overlay.activeXId?.trim());
  if (!authorized) return { canBulk: false, editableChapters: [] };

  // Administrators can bulk-create. Ordinary chapter owners can only edit/delete
  // their *own* private rows, based on the server's per-row authorization bit.
  const canBulk = perRowOverlay.viewerCanEditChapters === true;
  // Public SSG chapters lack note/visibility fields, so editing them would
  // silently erase stored note content. Do not infer permission from author name.
  const publicIds = new Set(publicChapters.map((chapter) => chapter.id));
  const editableChapters: EditableChapter[] = perRowOverlay.privateChapters
    .filter((chapter) => chapter.viewerCanManage === true && !publicIds.has(chapter.id))
    .map((chapter) => ({
      id: chapter.id,
      chapter_time: formatChapterTime(chapter.chapter_time),
      chapter_label: chapter.chapter_label,
      note: chapter.note,
      visibility: "private",
      canManage: true,
    }));
  return { canBulk, editableChapters };
}

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
  const { canBulk, editableChapters } = chapterManagementForOverlay(publicChapters, overlay, loading);
  return React.createElement(VideoUtilityDockIsland, {
    videoId,
    currentId,
    publicChapters,
    overlay,
    loading,
    canBulk,
    editableChapters,
    onRefresh: () => notifyVideoViewerOverlayChanged(videoId),
  });
}
export default VideoUtilityDockConnected;
