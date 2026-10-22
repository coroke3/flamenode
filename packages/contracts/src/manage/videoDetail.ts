import { z } from "zod";

// CURRENT: app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx, src/lib/admin/videoReviewDetail.ts (VideoReviewDetail)

export const ManageVideoReviewDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  creator_name: z.string(),
  creator_x_user_id: z.string().nullable(),
  created_at: z.number(),
  source_type: z.string(),
  youtube_video_id: z.string().nullable(),
  music: z.string().nullable(),
  credit: z.string().nullable(),
  intro_comment: z.string().nullable(),
  highlights: z.string().nullable(),
  production_story: z.string().nullable(),
  stagePermission: z.string().nullable(),
  visibility_status: z.string(),
  software_label: z.string().nullable(),
  event_ids: z.array(z.string()),
  customAnswers: z.array(z.object({ label: z.string(), answer: z.string(), required: z.boolean() })),
  members: z.array(
    z.object({
      name: z.string(),
      role: z.string().nullable(),
      x_user_id: z.string().nullable(),
      is_public_member: z.boolean(),
      chapters: z.string().nullable(),
    }),
  ),
});

export const ManageVideoDetailResponseSchema = z.object({
  isAdmin: z.boolean(),
  event: z.object({ id: z.string(), title: z.string(), accent_color: z.string().nullable() }),
  pendingCount: z.number(),
  /** video.status */
  canReview: z.boolean(),
  video: ManageVideoReviewDetailSchema,
  /** true when the question / member / chapter lists hit the 100-row API cap. */
  truncated: z.boolean(),
});

export type ManageVideoReviewDetail = z.infer<typeof ManageVideoReviewDetailSchema>;
export type ManageVideoDetailResponse = z.infer<typeof ManageVideoDetailResponseSchema>;
