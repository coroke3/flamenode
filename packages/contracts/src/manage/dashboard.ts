import { z } from "zod";
import { ManageAccessSchema, ManageNavigationEventSchema, ManageStaffRoleSchema } from "./shared.ts";

// CURRENT: app/(manage)/manage/page.tsx

export const ManageDashboardEventSchema = ManageNavigationEventSchema.extend({
  /** null for admins (CURRENT renders no role badge for admins). */
  staff_role: ManageStaffRoleSchema.nullable(),
});

/** The notification_outbox columns NotificationOutboxSummary renders (no lease token / run state). */
export const ManageNotificationRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().nullable(),
  payload_json: z.string(),
  attempt_count: z.number().nullable(),
  last_error: z.string().nullable(),
  dedupe_key: z.string().nullable(),
  recipient_user_id: z.string().nullable(),
  event_id: z.string().nullable(),
  created_at: z.number(),
});

export const ManageInboxRowSchema = z.object({
  id: z.string(),
  target_id: z.string(),
  operation: z.string(),
  actor_user_id: z.string(),
  created_at: z.number(),
});

export const ManageDashboardResponseSchema = z.object({
  access: ManageAccessSchema,
  /** ManageActiveXNotice input; null for admins (not rendered). */
  activeXUserId: z.string().nullable(),
  manageStaffXUserIds: z.array(z.string()),
  /** Dashboard order: CURRENT compareEventsByUpcomingPriority. */
  events: z.array(ManageDashboardEventSchema),
  eventsTruncated: z.boolean(),
  pendingReviewTotal: z.number(),
  acceptingEventCount: z.number(),
  failedNotificationCount: z.number(),
  /** true when notification_outbox.event_id is unavailable (old local D1); notifications is then empty. */
  notificationSchemaMissing: z.boolean(),
  notifications: z.array(ManageNotificationRowSchema),
  inbox: z.array(ManageInboxRowSchema),
});

export type ManageDashboardEvent = z.infer<typeof ManageDashboardEventSchema>;
export type ManageNotificationRow = z.infer<typeof ManageNotificationRowSchema>;
export type ManageInboxRow = z.infer<typeof ManageInboxRowSchema>;
export type ManageDashboardResponse = z.infer<typeof ManageDashboardResponseSchema>;
