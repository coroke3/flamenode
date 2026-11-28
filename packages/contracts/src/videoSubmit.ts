import { z } from "zod";

/**
 * MIG-0651 SA-086: POST /api/videos/free response contract.
 * Mirrors CURRENT VideoActionResult (src/lib/video/types.ts) without altering
 * client-visible fields; transport body cap is 8 MiB (VIDEO_SUBMISSION_BODY_LIMIT_BYTES).
 */
export const SA_086_VIDEO_SUBMIT_MAX_BODY_BYTES = 8 * 1024 * 1024;

export const VideoSubmitResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  videoId: z.string().optional(),
  youtubeVideoId: z.string().optional(),
  eventId: z.string().optional(),
  reason: z.string().optional(),
  pendingPublicReflection: z.boolean().optional(),
});

export type VideoSubmitResult = z.infer<typeof VideoSubmitResultSchema>;
