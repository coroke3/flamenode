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
  const perRowOverlay = overlay;
  // CURRENT Hono SA-012..015 requires an approved active X for every write,
  // including admin bulk and private-row update/delete. A true RH-031 manager
  // claim without an X identity is a read capability, NOT a valid write grant.
  const authorized = !loading && overlay.loggedIn &&
    !overlay.authUnavailable && !overlay.isBanned &&
    overlay.isTosAccepted && !overlay.termsReacceptRequired &&
    overlay.viewerXApproved && Boolean(overlay.activeXId?.trim());
  if (!authorized) return { canBulk: false, editableChapters: [] };

  const canBulk = perRowOverlay.viewerCanEditChapters === true;
  // Only current-D1 public rows with explicit server-calculated permission
  // may unlock an SSG chapter. Never derive a grant from title, author or ID.
  const publicIds = new Set(publicChapters.map((chapter) => chapter.id));
  const seen = new Set<string>();
  const editablePublic: EditableChapter[] = (perRowOverlay.editablePublicChapters ?? [])
    .filter((chapter) => chapter.viewerCanManage === true &&
      publicIds.has(chapter.id) && !seen.has(chapter.id) && seen.add(chapter.id))
    .map((chapter) => ({
      id: chapter.id,
      chapter_time: formatChapterTime(chapter.chapter_time),
      chapter_label: chapter.chapter_label,
      note: chapter.note,
      visibility: "public",
      canManage: true,
    }));
  const editablePrivate: EditableChapter[] = perRowOverlay.privateChapters
    .filter((chapter) => chapter.viewerCanManage === true && !publicIds.has(chapter.id))
    .map((chapter) => ({
      id: chapter.id,
      chapter_time: formatChapterTime(chapter.chapter_time),
      chapter_label: chapter.chapter_label,
      note: chapter.note,
      visibility: "private",
      canManage: true,
    }));
  return { canBulk, editableChapters: [...editablePublic, ...editablePrivate] };
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
