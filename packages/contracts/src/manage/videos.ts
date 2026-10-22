import { z } from "zod";

// CURRENT: app/(manage)/manage/events/[id]/videos/page.tsx (VideoReviewQueueRow)

export const ManageVideoQueueRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  source_type: z.string().nullable(),
  youtube_video_id: z.string().nullable(),
  display_name: z.string(),
  visibility_status: z.string(),
  created_at: z.number(),
  stage_permission_summary: z.string(),
  required_unanswered_count: z.number(),
});

export const ManageVideosResponseSchema = z.object({
  isAdmin: z.boolean(),
  event: z.object({ id: z.string(), title: z.string(), accent_color: z.string().nullable() }),
  pendingCount: z.number(),
  /** video.status */
  canApproveVideoStatus: z.boolean(),
  /** normalised filter: "" (all), a group key (review/public/private/closed) or a visibility status */
  statusFilter: z.string(),
  filterLabel: z.string(),
  isReviewFilter: z.boolean(),
  offset: z.number(),
  pageSize: z.number(),
  rows: z.array(ManageVideoQueueRowSchema),
});

export type ManageVideoQueueRow = z.infer<typeof ManageVideoQueueRowSchema>;
export type ManageVideosResponse = z.infer<typeof ManageVideosResponseSchema>;
