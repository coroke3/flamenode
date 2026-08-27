import type { SlotViewerRelation } from "./slotIdentityCore.ts";

export type SlotViewerOverlaySlot = {
  id: string;
  display_name: string | null;
  reserved_x_id: string | null;
  profile_x_user_id: string | null;
  submitted_icon_url: string | null;
  is_owned_by_viewer: boolean;
  viewer_relation: SlotViewerRelation;
  group_key: string | null;
  /** 本人枠だけ返す。結合/拡張UIのX一致判定用。 */
  x_user_id: string | null;
};

export type SlotViewerOverlayDto = {
  loggedIn: boolean;
  authUnavailable: boolean;
  needsTermsAcceptance: boolean;
  canReserveSlot: boolean;
  canPost: boolean;
  operatorOverrideAllowed: boolean;
  viewerXId: string | null;
  viewerXIdNotice: string | null;
  slots: SlotViewerOverlaySlot[];
};

export function emptySlotViewerOverlay(
  authUnavailable = false,
): SlotViewerOverlayDto {
  return {
    loggedIn: false,
    authUnavailable,
    needsTermsAcceptance: false,
    canReserveSlot: false,
    canPost: false,
    operatorOverrideAllowed: false,
    viewerXId: null,
    viewerXIdNotice: null,
    slots: [],
  };
}
