import { z } from "zod";

/**
 * SA-087: CURRENT toggleVideoInteraction(formData) accepts kind and video_id.
 * The route parameter replaces video_id; a request toggles the stored state.
 */
export const VideoInteractionBodySchema = z.object({
  kind: z.enum(["like", "bookmark"]),
});
export type VideoInteractionBody = z.infer<typeof VideoInteractionBodySchema>;

export const VideoInteractionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  active: z.boolean().optional(),
  videoId: z.string().optional(),
  reason: z.string().optional(),
});
export type VideoInteractionResult = z.infer<typeof VideoInteractionResultSchema>;
