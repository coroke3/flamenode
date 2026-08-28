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

export type SlotViewerOverlayState = {
  id: string;
  status: "available" | "reserved" | "submitted";
};

export type SlotViewerOverlayDto = {
  loggedIn: boolean;
  authUnavailable: boolean;
  isBanned: boolean;
  needsTermsAcceptance: boolean;
  canReserveSlot: boolean;
  canPost: boolean;
  operatorOverrideAllowed: boolean;
  viewerXId: string | null;
  viewerXIdNotice: string | null;
  /**
   * 認証済みviewer向けの軽量なcanonical状態。
   * public R2 snapshotの再生成待ち中でも予約/解放直後のstatusだけはD1正本へ合わせる。
   */
  slotStates: SlotViewerOverlayState[];
  slots: SlotViewerOverlaySlot[];
};

export function emptySlotViewerOverlay(
  authUnavailable = false,
): SlotViewerOverlayDto {
  return {
    loggedIn: false,
    authUnavailable,
    isBanned: false,
    needsTermsAcceptance: false,
    canReserveSlot: false,
    canPost: false,
    operatorOverrideAllowed: false,
    viewerXId: null,
    viewerXIdNotice: null,
    slotStates: [],
    slots: [],
  };
}
