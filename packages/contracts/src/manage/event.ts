import { z } from "zod";

// CURRENT: app/(manage)/manage/events/[id]/staff/page.tsx and slots/page.tsx

const ManageEventHeadSchema = z.object({
  id: z.string(),
  title: z.string(),
  accent_color: z.string().nullable(),
});

export const ManageStaffMemberSchema = z.object({
  id: z.string(),
  x_user_id: z.string().nullable(),
  display_name: z.string(),
  permission_preset: z.string().nullable(),
  is_public: z.number(),
  public_role_label: z.string().nullable(),
  permission_keys: z.array(z.string()),
  x_name: z.string().nullable(),
  /** External https icons only; internal icons need the AUTH_SECRET signature (not available in the API yet). */
  icon_url: z.string().nullable(),
});

export const ManageStaffResponseSchema = z.object({
  event: ManageEventHeadSchema,
  isAdmin: z.boolean(),
  canManageMembers: z.boolean(),
  pendingCount: z.number(),
  members: z.array(ManageStaffMemberSchema),
  ownerCount: z.number(),
  publicCount: z.number(),
  approvedCount: z.number(),
  membersTruncated: z.boolean(),
});

export const ManageSlotStatusFilterSchema = z.enum(["all", "available", "reserved", "submitted"]);

export const ManageSlotRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  slot_label: z.string().nullable(),
  start_time: z.number().nullable(),
  sort_order: z.number().nullable(),
  status: z.string(),
  display_name: z.string().nullable(),
  x_user_id: z.string().nullable(),
  reserved_x_id_snapshot: z.string().nullable(),
  reserved_by_user_id: z.string().nullable(),
  discord_display_name: z.string().nullable(),
  discord_id: z.string().nullable(),
  reservation_group_id: z.string().nullable(),
  video_id: z.string().nullable(),
  updated_at: z.number(),
  version: z.number(),
});

export const ManageSlotsResponseSchema = z.object({
  event: ManageEventHeadSchema.extend({
    slot_part_gap_minutes: z.number().nullable(),
    parts: z.array(z.string()),
  }),
  isAdmin: z.boolean(),
  statusFilter: ManageSlotStatusFilterSchema,
  offset: z.number(),
  pageSize: z.number(),
  pendingCount: z.number(),
  total: z.number(),
  counts: z.record(z.number()),
  slots: z.array(ManageSlotRowSchema),
});

export type ManageStaffMember = z.infer<typeof ManageStaffMemberSchema>;
export type ManageStaffResponse = z.infer<typeof ManageStaffResponseSchema>;
export type ManageSlotRow = z.infer<typeof ManageSlotRowSchema>;
export type ManageSlotsResponse = z.infer<typeof ManageSlotsResponseSchema>;
