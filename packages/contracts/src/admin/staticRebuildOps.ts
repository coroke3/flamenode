import { z } from "zod";

/** MIG-0643 U04: SA-106 uses form field video_id; HTTP path is authoritative. */
export const AdminYoutubeResyncVideoIdSchema = z.string().trim().min(1).max(128);
export const AdminYoutubeResyncResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  already_pending: z.boolean().optional(),
});
export type AdminYoutubeResyncResult = z.infer<typeof AdminYoutubeResyncResultSchema>;
