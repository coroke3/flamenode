import { z } from "zod";
import {
  ChapterItemSchema,
  LinkedXUserSchema,
  OnboardingStateSchema,
  PersonalUserSchema,
  VideoCardSchema,
} from "./shared.ts";

// CURRENT: app/(auth)/dashboard/page.tsx

function previewList<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), hasMore: z.boolean() });
}

export const DashboardActiveSlotSchema = z.object({
  slot: z.object({
    id: z.string(),
    status: z.enum(["reserved", "submitted"]),
    start_time: z.number().nullable(),
    slot_label: z.string().nullable(),
    video_id: z.string().nullable(),
  }),
  event: z.object({
    id: z.string(),
    title: z.string(),
    accent_color: z.string().nullable(),
  }),
});

export const DashboardResponseSchema = z.object({
  user: PersonalUserSchema,
  onboarding: OnboardingStateSchema,
  linkedXUsers: z.array(LinkedXUserSchema),
  myVideos: previewList(VideoCardSchema),
  collabVideos: previewList(VideoCardSchema),
  myChapters: previewList(ChapterItemSchema),
  activeSlot: DashboardActiveSlotSchema.nullable(),
  stats: z.object({
    likes: z.number(),
    views: z.number(),
    video_count: z.number(),
    event_count: z.number(),
  }),
});

export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
