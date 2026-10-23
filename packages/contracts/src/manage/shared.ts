import { z } from "zod";

// MIG-0624: DTOs for the authenticated Manage read APIs (/api/manage/*).
// CURRENT sources: app/(manage)/layout.tsx, src/lib/auth/manageAuthorization.ts, src/lib/manage/navigationEvents.ts.

export const ManageAccessSchema = z.object({
  isAdmin: z.boolean(),
  canAccessAdmin: z.boolean(),
  canAccessManage: z.boolean(),
  canManageXIdLinkRequests: z.boolean(),
});

/** CURRENT ManageNavigationEvent (created_at is an ordering detail and is not exposed). */
export const ManageNavigationEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  accent_color: z.string().nullable(),
  visibility_status: z.string().nullable(),
  start_time: z.number().nullable(),
  end_time: z.number().nullable(),
  entry_start_time: z.number().nullable(),
  entry_end_time: z.number().nullable(),
  pending_review_count: z.number(),
});

export const ManageStaffRoleSchema = z.enum(["representative", "editor"]);

export const ManageNavigationResponseSchema = z.object({
  access: ManageAccessSchema,
  /** Sidebar order: start_time DESC, created_at DESC, id DESC. */
  events: z.array(ManageNavigationEventSchema),
  /** true when the manageable event list was cut at the API cap (CURRENT is unbounded). */
  truncated: z.boolean(),
});

export type ManageAccess = z.infer<typeof ManageAccessSchema>;
export type ManageNavigationEvent = z.infer<typeof ManageNavigationEventSchema>;
export type ManageStaffRole = z.infer<typeof ManageStaffRoleSchema>;
export type ManageNavigationResponse = z.infer<typeof ManageNavigationResponseSchema>;
