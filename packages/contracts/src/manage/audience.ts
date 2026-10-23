import { z } from "zod";

// CURRENT: app/(manage)/manage/events/[id]/audience/page.tsx

export const ManageAudienceRowSchema = z.object({
  x_user_id: z.string(),
  x_name: z.string().nullable(),
  icon_url: z.string().nullable(),
  approval_status: z.string().nullable(),
  slot_count: z.number(),
  submitted_count: z.number(),
  video_count: z.number(),
});

export const ManageAudienceResponseSchema = z.object({
  isAdmin: z.boolean(),
  event: z.object({ id: z.string(), title: z.string(), accent_color: z.string().nullable() }),
  pendingCount: z.number(),
  audience: z.array(ManageAudienceRowSchema),
  /** true when either source list (slot holders / video submitters) hit the 100-row API cap. */
  truncated: z.boolean(),
});

export type ManageAudienceRow = z.infer<typeof ManageAudienceRowSchema>;
export type ManageAudienceResponse = z.infer<typeof ManageAudienceResponseSchema>;
