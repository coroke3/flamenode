import { z } from "zod";

// MIG-0634 U03 (RH-031): GET /api/videos/:id/viewer-overlay.
// CURRENT: src/lib/video/videoViewerOverlayCore.ts (VideoViewerOverlayDto) and
// app/api/videos/[id]/viewer-overlay/route.ts.

export const VideoViewerOverlayChapterSchema = z.object({
  id: z.string(),
  chapter_time: z.number(),
  chapter_label: z.string(),
  visibility: z.literal("private"),
  note: z.string().nullable(),
  author_name: z.string().nullable(),
  author_icon: z.string().nullable(),
});

export const VideoViewerOverlayPlaylistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  youtube_video_id: z.string().nullable(),
  display_name: z.string(),
});

export const VideoViewerOverlayResponseSchema = z.object({
  loggedIn: z.boolean(),
  authUnavailable: z.boolean(),
  isBanned: z.boolean(),
  isTosAccepted: z.boolean(),
  termsReacceptRequired: z.boolean(),
  activeXId: z.string().nullable(),
  likeActive: z.boolean(),
  bookmarkActive: z.boolean(),
  viewerXApproved: z.boolean(),
  privateChapters: z.array(VideoViewerOverlayChapterSchema),
  playlistLabel: z.string(),
  playlistItems: z.array(VideoViewerOverlayPlaylistItemSchema),
});

export const VideoViewerOverlayErrorSchema = z.object({
  error: z.enum(["invalid_video_id", "video_not_found", "viewer_overlay_unavailable"]),
});

export type VideoViewerOverlayChapter = z.infer<typeof VideoViewerOverlayChapterSchema>;
export type VideoViewerOverlayPlaylistItem = z.infer<typeof VideoViewerOverlayPlaylistItemSchema>;
export type VideoViewerOverlayResponse = z.infer<typeof VideoViewerOverlayResponseSchema>;
export type VideoViewerOverlayDto = VideoViewerOverlayResponse;
export type VideoViewerOverlayError = z.infer<typeof VideoViewerOverlayErrorSchema>;
