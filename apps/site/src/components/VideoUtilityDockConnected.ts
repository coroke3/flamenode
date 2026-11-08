import React from "react";
import { useVideoViewerOverlay, notifyVideoViewerOverlayChanged } from "../lib/viewerOverlay.ts";
import { VideoUtilityDockIsland, type PublicVideoChapter } from "./VideoUtilityDockIsland.ts";
import type { EditableChapter } from "./VideoChapterIsland.ts";
import type { VideoViewerOverlayDto } from "@flamenode/contracts";
import { formatChapterTime } from "../../../../packages/domain/src/video/chapterTime.ts";

/**
 * MIG-0518: consume the server-calculated RH-031 chapter-admin claim only.
 * MIG-0634 follow-up #662 introduces the optional field. Until the contract
 * lands and the parsed overlay actually contains true, all writes stay disabled.
 */
export function chapterManagementForOverlay(
  publicChapters: readonly PublicVideoChapter[],
  overlay: VideoViewerOverlayDto,
  loading: boolean,
): { canBulk: boolean; editableChapters: EditableChapter[] } {
  const claim = (overlay as VideoViewerOverlayDto & { viewerCanEditChapters?: boolean }).viewerCanEditChapters;
  const authorized = !loading && claim === true && overlay.loggedIn &&
    !overlay.authUnavailable && !overlay.isBanned &&
    overlay.isTosAccepted && !overlay.termsReacceptRequired &&
    overlay.viewerXApproved && Boolean(overlay.activeXId?.trim());
  if (!authorized) return { canBulk: false, editableChapters: [] };

  // The SSG public-chapter DTO has no note or visibility facts. Never submit
  // an edit with an invented empty note: it would erase existing CURRENT data.
  // Only RH-031 private rows provide the complete edit fields.
  const ids = new Set(publicChapters.map((chapter) => chapter.id));
  const editableChapters: EditableChapter[] = overlay.privateChapters
    .filter((chapter) => !ids.has(chapter.id))
    .map((chapter) => ({
      id: chapter.id,
      chapter_time: formatChapterTime(chapter.chapter_time),
      chapter_label: chapter.chapter_label,
      note: chapter.note,
      visibility: "private",
      canManage: true,
    }));
  return { canBulk: true, editableChapters };
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
