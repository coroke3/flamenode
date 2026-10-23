import { z } from "zod";

// CURRENT: app/(manage)/manage/x-link-requests/page.tsx, src/lib/admin/enrichXLinkPendingRows.ts (XLinkRequestRow)

export const ManageXLinkRequestSchema = z.object({
  id: z.string(),
  requested_x_id: z.string(),
  requested_by_auth_user_id: z.string(),
  discord_name: z.string().nullable(),
  discord_image: z.string().nullable(),
  requested_at: z.number(),
  request_type: z.string(),
  target_x_user_id: z.string().nullable(),
  requested_x_name: z.string().nullable(),
  requested_icon_url: z.string().nullable(),
  requested_approval_status: z.string().nullable(),
  target_icon_url: z.string().nullable(),
  target_approval_status: z.string().nullable(),
});

export const ManageXLinkRequestsResponseSchema = z.object({
  rows: z.array(ManageXLinkRequestSchema),
});

export type ManageXLinkRequest = z.infer<typeof ManageXLinkRequestSchema>;
export type ManageXLinkRequestsResponse = z.infer<typeof ManageXLinkRequestsResponseSchema>;
