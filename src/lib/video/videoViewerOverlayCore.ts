import type { VideoChapterOverlayEntry } from "@/lib/publicData/privateVideoChapterOverlay";

/** server query / client validation share the same bounded private chapter payload. */
export const VIDEO_VIEWER_OVERLAY_MAX_PRIVATE_CHAPTERS = 500;

export type VideoViewerOverlayPlaylistItem = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
};

export type VideoViewerOverlayDto = {
  loggedIn: boolean;
  authUnavailable: boolean;
  isBanned: boolean;
  isTosAccepted: boolean;
  termsReacceptRequired: boolean;
  activeXId: string | null;
  likeActive: boolean;
  bookmarkActive: boolean;
  viewerXApproved: boolean;
  privateChapters: VideoChapterOverlayEntry[];
  playlistLabel: string;
  playlistItems: VideoViewerOverlayPlaylistItem[];
};
