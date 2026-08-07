import type {
  VideoEditPermissionViewModel,
  VideoFieldPermission,
} from "@/lib/video/videoEditPermissionView";

/** ロック解除の案内先。自動切替はしない。 */
export function resolvePermissionUnlockHint(
  permission: VideoFieldPermission,
  viewModel: Pick<
    VideoEditPermissionViewModel,
    "canOfferAdminMode" | "canOfferEventMode" | "privilegeMode"
  >,
): "admin" | "event" | null {
  if (permission.editable) return null;
  if (viewModel.privilegeMode !== "normal") return null;

  // 管理者限定項目は admin 案内を優先。event では触れないことが多い。
  if (permission.reason === "admin_only") {
    return viewModel.canOfferAdminMode ? "admin" : null;
  }

  // 所有者ポリシー不足・非所有者で運営モードに入れるなら event を案内。
  if (
    (permission.reason === "owner_policy_denied" ||
      permission.reason === "not_owner" ||
      permission.reason === "collaborator_not_granted" ||
      permission.reason === "event_permission_denied") &&
    viewModel.canOfferEventMode
  ) {
    return "event";
  }

  if (viewModel.canOfferAdminMode) return "admin";
  return null;
}

export function hasAnyEditableVideoFormSection(
  viewModel: VideoEditPermissionViewModel,
): boolean {
  return (
    viewModel.identity.editable ||
    viewModel.basics.editable ||
    viewModel.youtube.editable ||
    viewModel.credits.editable ||
    viewModel.descriptions.editable ||
    viewModel.members.editable ||
    viewModel.memberChapters.editable ||
    viewModel.primaryEvent.editable
  );
}
