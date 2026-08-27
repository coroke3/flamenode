import type { VideoChapterOverlayEntry } from "@/lib/publicData/privateVideoChapterOverlay";

export type VideoViewerOverlayPlaylistItem = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
};

export type VideoViewerOverlayDto = {
  loggedIn: boolean;
  authUnavailable: boolean;
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
