// Port of CURRENT src/lib/video/videoEditPermissionView.ts (MIG-0712). Same output for permission badge and field-note formatters.
// DB/auth-free subset; full editable ownership checks remain in the server/owned logic.
export type VideoFieldPermissionSource =
  | "owner_general"
  | "event_staff"
  | "admin"
  | "none";

export type VideoFieldPermissionReason =
  | "allowed"
  | "owner_policy_denied"
  | "not_owner"
  | "collaborator_not_granted"
  | "event_permission_denied"
  | "admin_only";

export type VideoFieldPermission = {
  editable: boolean;
  source: VideoFieldPermissionSource;
  reason: VideoFieldPermissionReason;
  eventId?: string;
  eventTitle?: string;
  /** UI表示用ラベル（内部 key ではない） */
  label: string;
};


export function formatVideoFieldPermissionReason(
  permission: VideoFieldPermission,
): string {
  switch (permission.reason) {
    case "allowed":
      return "";
    case "owner_policy_denied":
      return "この項目は、現在の一般作品権限では編集できません。";
    case "not_owner":
      return "この作品の所有者ではないため編集できません。";
    case "collaborator_not_granted":
      return "合作メンバーとして登録されていますが、作品編集権限が付与されていません。";
    case "event_permission_denied": {
      const base =
        "この操作に必要なイベント運営権限が付与されていません。";
      if (permission.label) {
        return `${base}必要な権限: ${permission.label}`;
      }
      return base;
    }
    case "admin_only":
      return "この項目は管理者権限でのみ変更できます。";
    default:
      return "";
  }
}

export type PermissionBadge = {
  kind:
    | "editable"
    | "mixed"
    | "owner-denied"
    | "event"
    | "admin"
    | "locked";
  text: string;
};

export type VideoPermissionGroupState = "editable" | "mixed" | "locked";

export function resolveVideoPermissionGroupState(
  permissions: readonly VideoFieldPermission[],
): VideoPermissionGroupState {
  const editableCount = permissions.filter((permission) => permission.editable).length;
  if (permissions.length > 0 && editableCount === permissions.length) return "editable";
  if (editableCount > 0) return "mixed";
  return "locked";
}

export function formatPermissionGroupBadge(
  permissions: readonly VideoFieldPermission[],
): PermissionBadge {
  switch (resolveVideoPermissionGroupState(permissions)) {
    case "editable":
      return { kind: "editable", text: "編集可能" };
    case "mixed":
      return { kind: "mixed", text: "一部のみ編集可能" };
    case "locked":
    default:
      return { kind: "locked", text: "編集不可" };
  }
}

export function formatPermissionBadge(
  permission: VideoFieldPermission,
): PermissionBadge {
  switch (permission.reason) {
    case "allowed":
      return { kind: "editable", text: "編集可能" };
    case "owner_policy_denied":
      return { kind: "owner-denied", text: "所有者権限では編集不可" };
    case "event_permission_denied":
      return { kind: "event", text: "運営権限が必要" };
    case "admin_only":
      return { kind: "admin", text: "管理者限定" };
    case "not_owner":
    case "collaborator_not_granted":
      return { kind: "locked", text: "編集不可" };
    default:
      return { kind: "locked", text: "編集不可" };
  }
}

