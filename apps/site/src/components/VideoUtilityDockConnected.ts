import React from "react";
import { useVideoViewerOverlay, notifyVideoViewerOverlayChanged } from "../lib/viewerOverlay.ts";
import { VideoUtilityDockIsland, type PublicVideoChapter } from "./VideoUtilityDockIsland.ts";
import type { EditableChapter } from "./VideoChapterIsland.ts";
import { VideoViewerOverlayResponseSchema, type VideoViewerOverlayDto } from "@flamenode/contracts";
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
    .filter((chapter) => {
      if (chapter.viewerCanManage !== true || !publicIds.has(chapter.id) || seen.has(chapter.id)) {
        return false;
      }
      seen.add(chapter.id);
      return true;
    })
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
  // Keep per-viewer single-chapter lookups ephemeral. The baseline overlay
  // object is a version token: switching X, signing out, refreshing or
  // changing video invalidates previously fetched editor DTOs immediately.
  const latestOverlay = React.useRef(overlay);
  latestOverlay.current = overlay;
  // Refresh can be requested before the overlay hook emits a new object.
  // Invalidate an in-flight targeted editor response immediately, even when
  // the old overlay reference is still current for this React render.
  const editRequestEpoch = React.useRef(0);
  const [confirmed, setConfirmed] = React.useState<{
    source: VideoViewerOverlayDto;
    rows: EditableChapter[];
  } | null>(null);
  const { canBulk, editableChapters } = chapterManagementForOverlay(publicChapters, overlay, loading);
  const trustedExtras = !loading && confirmed?.source === overlay ? confirmed.rows : [];
  const seen = new Set(editableChapters.map((chapter) => chapter.id));
  const allEditableChapters = [...editableChapters, ...trustedExtras.filter((chapter) => !seen.has(chapter.id))];

  const requestPublicChapterEdit = async (chapterId: string): Promise<boolean> => {
    const originalOverlay = latestOverlay.current;
    const requestEpoch = editRequestEpoch.current;
    if (loading || !originalOverlay.loggedIn || originalOverlay.authUnavailable ||
        originalOverlay.isBanned || !originalOverlay.isTosAccepted ||
        originalOverlay.termsReacceptRequired || !originalOverlay.viewerXApproved ||
        !originalOverlay.activeXId?.trim() ||
        !publicChapters.some((chapter) => chapter.id === chapterId && chapter.kind !== "member") ||
        chapterId.length > 128) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const url = `/api/videos/${encodeURIComponent(videoId)}/viewer-overlay?editChapterId=${encodeURIComponent(chapterId)}`;
      const response = await fetch(url, {
        credentials: "same-origin", cache: "no-store",
        headers: { accept: "application/json" }, signal: controller.signal,
      });
      if (!response.ok || latestOverlay.current !== originalOverlay ||
          editRequestEpoch.current !== requestEpoch) return false;
      const parsed = VideoViewerOverlayResponseSchema.safeParse(await response.json());
      if (!parsed.success || latestOverlay.current !== originalOverlay ||
          editRequestEpoch.current !== requestEpoch ||
          parsed.data.activeXId !== originalOverlay.activeXId) return false;
      const editor = chapterManagementForOverlay(publicChapters, parsed.data, false)
        .editableChapters.find((chapter) => chapter.id === chapterId && chapter.visibility === "public");
      if (!editor || editRequestEpoch.current !== requestEpoch) return false;
      setConfirmed((previous) => {
        // React may defer this state updater until after a refresh has run.
        if (editRequestEpoch.current !== requestEpoch ||
            latestOverlay.current !== originalOverlay) return previous;
        return {
          source: originalOverlay,
          rows: previous?.source === originalOverlay
            ? [...previous.rows.filter((row) => row.id !== chapterId), editor]
            : [editor],
        };
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  return React.createElement(VideoUtilityDockIsland, {
    videoId,
    currentId,
    publicChapters,
    overlay,
    loading,
    canBulk,
    editableChapters: allEditableChapters,
    onRequestPublicChapterEdit: requestPublicChapterEdit,
    onRefresh: () => {
      editRequestEpoch.current += 1;
      setConfirmed(null);
      notifyVideoViewerOverlayChanged(videoId);
    },
  });
}
export default VideoUtilityDockConnected;
