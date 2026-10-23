import { z } from "zod";
import { ManageNotificationRowSchema } from "./dashboard.ts";
import { ManageStaffRoleSchema } from "./shared.ts";

// CURRENT: app/(manage)/manage/events/[id]/page.tsx and app/(manage)/manage/notifications/page.tsx

export const ManageNotificationWithRecipientSchema = ManageNotificationRowSchema.extend({
  /** CURRENT lookupNotificationRecipients; null when the recipient user row does not exist. */
  recipient: z
    .object({
      userName: z.string().nullable(),
      discordId: z.string().nullable(),
      notificationsEnabled: z.boolean(),
    })
    .nullable(),
});

export const ManageNotifFilterSchema = z.enum(["all", "video", "x_id", "slot", "chapter", "other"]);

export const ManageOverviewResponseSchema = z.object({
  isAdmin: z.boolean(),
  event: z.object({
    id: z.string(),
    title: z.string(),
    accent_color: z.string().nullable(),
    visibility_status: z.string().nullable(),
    start_time: z.number().nullable(),
    end_time: z.number().nullable(),
    entry_start_time: z.number().nullable(),
    entry_end_time: z.number().nullable(),
    pending_review_count: z.number(),
  }),
  editorRole: ManageStaffRoleSchema.nullable(),
  activeXUserId: z.string().nullable(),
  manageStaffXUserIds: z.array(z.string()),
  publicVideoCount: z.number(),
  slotCounts: z.record(z.number()),
  pendingVideos: z.array(
    z.object({ id: z.string(), title: z.string(), display_name: z.string().nullable(), created_at: z.number() }),
  ),
  auditLogs: z.array(
    z.object({ id: z.string(), operation: z.string(), actor_user_id: z.string().nullable(), created_at: z.number() }),
  ),
  notifCategory: ManageNotifFilterSchema,
  notifCounts: z.object({
    all: z.number(),
    video: z.number(),
    x_id: z.number(),
    slot: z.number(),
    chapter: z.number(),
    other: z.number(),
  }),
  notificationSchemaMissing: z.boolean(),
  notifications: z.array(ManageNotificationWithRecipientSchema),
});

export const ManageNotificationCenterResponseSchema = z.object({
  isAdmin: z.boolean(),
  activeXUserId: z.string().nullable(),
  manageStaffXUserIds: z.array(z.string()),
  eventFilter: z.string(),
  notifFilter: ManageNotifFilterSchema,
  statusFilter: z.string(),
  /** Event selector (non-admin only; admins get []). */
  managedEvents: z.array(z.object({ id: z.string(), title: z.string() })),
  /** Titles for the event column (sidebar events, at most 100). */
  eventTitles: z.record(z.string()),
  schemaMissing: z.boolean(),
  failedCount: z.number(),
  notifications: z.array(ManageNotificationWithRecipientSchema),
});

export type ManageNotificationWithRecipient = z.infer<typeof ManageNotificationWithRecipientSchema>;
export type ManageOverviewResponse = z.infer<typeof ManageOverviewResponseSchema>;
export type ManageNotificationCenterResponse = z.infer<typeof ManageNotificationCenterResponseSchema>;
