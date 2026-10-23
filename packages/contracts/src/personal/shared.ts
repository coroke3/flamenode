import { z } from "zod";

// MIG-0611: DTOs for the authenticated Personal read APIs (/api/personal/*).
// CURRENT sources: src/lib/auth/guard.tsx (AuthSessionUser), src/lib/auth/onboarding.ts,
// src/components/video/VideoCard.tsx (VideoCardData). No email / discord_id / counters beyond these.

export const PersonalUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  role: z.enum(["user", "admin", "moderator"]),
  is_banned: z.number(),
  active_x_user_id: z.string().nullable(),
  is_tos_accepted: z.number(),
  accepted_terms_version_id: z.string().nullable(),
  terms_reaccept_required: z.number(),
});

export const XApprovalStatusSchema = z.enum(["pending", "approved", "rejected", "imported"]);

export const LinkedXUserSchema = z.object({
  id: z.string(),
  x_name: z.string(),
  icon_url: z.string().nullable(),
  approval_status: XApprovalStatusSchema.nullable(),
});

export const OnboardingStateSchema = z.object({
  needsTermsAcceptance: z.boolean(),
  xIdentityStatus: z.enum(["none", "pending", "approved", "rejected"]),
  requestedXId: z.string().nullable(),
  activeApprovedXId: z.string().nullable(),
  canReserveSlot: z.boolean(),
  canPost: z.boolean(),
});

export const VideoCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  youtube_video_id: z.string().nullable(),
  display_name: z.string(),
  icon_url: z.string().nullable(),
  creator_x_user_id: z.string().nullable(),
  primary_event_id: z.string().nullable(),
  scheduled_time: z.number().nullable(),
  status: z.string().nullable(),
});

export const ChapterItemSchema = z.object({
  id: z.string(),
  video_id: z.string(),
  youtube_video_id: z.string().nullable(),
  video_title: z.string().nullable(),
  chapter_time: z.number(),
  chapter_label: z.string(),
  visibility: z.enum(["private", "public"]).nullable(),
  created_at: z.number(),
});

export const PersonalSessionResponseSchema = z.object({
  user: PersonalUserSchema,
});

export type PersonalUser = z.infer<typeof PersonalUserSchema>;
export type XApprovalStatus = z.infer<typeof XApprovalStatusSchema>;
export type LinkedXUser = z.infer<typeof LinkedXUserSchema>;
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;
export type VideoCard = z.infer<typeof VideoCardSchema>;
export type ChapterItem = z.infer<typeof ChapterItemSchema>;
export type PersonalSessionResponse = z.infer<typeof PersonalSessionResponseSchema>;
