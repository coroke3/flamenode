import { z } from "zod";
import { PersonalUserSchema, XApprovalStatusSchema } from "./shared.ts";

// CURRENT: app/(auth)/dashboard/settings/page.tsx (SettingsXIdRow / XIdentityRequestHistoryRow)

export const SettingsXIdSchema = z.object({
  id: z.string(),
  x_name: z.string(),
  icon_url: z.string().nullable(),
  approval_status: XApprovalStatusSchema,
  requested_at: z.number().nullable(),
  profile_text: z.string().nullable(),
  portfolio_contact: z.string().nullable(),
  youtube_channel_url: z.string().nullable(),
  other_social_links: z.string().nullable(),
});

export const XIdentityRequestRowSchema = z.object({
  id: z.string(),
  request_type: z.enum(["new_link", "existing_link", "alias", "merge", "revert_merge"]),
  requested_x_id: z.string().nullable(),
  source_x_user_id: z.string().nullable(),
  target_x_user_id: z.string().nullable(),
  parent_request_id: z.string().nullable(),
  revert_deadline_at: z.number().nullable(),
  status: z.enum(["pending", "approved", "rejected", "done", "cancelled"]),
  requested_at: z.number(),
  updated_at: z.number(),
});

export const SettingsResponseSchema = z.object({
  user: PersonalUserSchema,
  xIds: z.array(SettingsXIdSchema),
  requestHistory: z.array(XIdentityRequestRowSchema),
  /** Panel X ID chosen like CURRENT (x query -> active -> first sorted) when the X tab is shown. */
  panel: z.object({
    xId: z.string().nullable(),
    iconCandidates: z.array(z.string()),
    channelCandidates: z.array(z.string()),
  }),
});

export type SettingsXId = z.infer<typeof SettingsXIdSchema>;
export type XIdentityRequestRow = z.infer<typeof XIdentityRequestRowSchema>;
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
