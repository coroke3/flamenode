import { z } from "zod";

// MIG-0604 U01 (RH-014): GET /api/events/:id/slots/viewer-overlay.
// CURRENT: src/lib/slots/slotViewerOverlayCore.ts (SlotViewerOverlayDto) and the error bodies of
// app/api/events/[id]/slots/viewer-overlay/route.ts.

export const SlotViewerRelationSchema = z.enum(["active", "unassigned", "account_other", "none"]);

export const SlotViewerOverlaySlotSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  reserved_x_id: z.string().nullable(),
  profile_x_user_id: z.string().nullable(),
  submitted_icon_url: z.string().nullable(),
  is_owned_by_viewer: z.boolean(),
  viewer_relation: SlotViewerRelationSchema,
  group_key: z.string().nullable(),
  /** Own slots only (merge / extend UI X matching). */
  x_user_id: z.string().nullable(),
});

export const SlotViewerOverlayResponseSchema = z.object({
  loggedIn: z.boolean(),
  authUnavailable: z.boolean(),
  isBanned: z.boolean(),
  needsTermsAcceptance: z.boolean(),
  canReserveSlot: z.boolean(),
  canPost: z.boolean(),
  operatorOverrideAllowed: z.boolean(),
  viewerXId: z.string().nullable(),
  viewerXIdNotice: z.string().nullable(),
  slots: z.array(SlotViewerOverlaySlotSchema),
});

export const SlotViewerOverlayErrorSchema = z.object({
  error: z.enum(["invalid_event_id", "event_not_found", "viewer_overlay_unavailable"]),
});

export type SlotViewerOverlaySlot = z.infer<typeof SlotViewerOverlaySlotSchema>;
export type SlotViewerOverlayResponse = z.infer<typeof SlotViewerOverlayResponseSchema>;
