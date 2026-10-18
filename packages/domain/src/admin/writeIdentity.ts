export type WriteIdentity = {
  role: string;
  is_banned: number;
  is_tos_accepted: number;
  terms_reaccept_required: number;
};

export type WriteIdentityDenyReason =
  | "banned"
  | "tos_required"
  | "tos_reaccept_required"
  | "forbidden";

export function evaluateWriteIdentity(
  user: WriteIdentity,
  requiredRole?: "admin",
): WriteIdentityDenyReason | null {
  if (user.is_banned === 1) return "banned";
  if (user.is_tos_accepted !== 1) return "tos_required";
  if (user.terms_reaccept_required === 1) return "tos_reaccept_required";
  if (requiredRole === "admin" && user.role !== "admin") return "forbidden";
  return null;
}

export type ActiveXWriteAccessDenyReason =
  | "active_x_required"
  | "active_x_rejected"
  | "active_x_not_approved";

export function evaluateActiveXWriteAccess(input: {
  requireActiveXId: boolean;
  requireApprovedActiveXId: boolean;
  activeXId: string | null;
  approvalStatus: string | null;
  approvedXIds: readonly string[];
}): ActiveXWriteAccessDenyReason | null {
  const needActive =
    input.requireActiveXId || input.requireApprovedActiveXId;
  if (!needActive) return null;
  if (!input.activeXId || input.approvalStatus == null) {
    return "active_x_required";
  }
  if (input.approvalStatus === "rejected") return "active_x_rejected";
  if (
    input.requireApprovedActiveXId &&
    (input.approvalStatus !== "approved" ||
      !input.approvedXIds.includes(input.activeXId))
  ) {
    return "active_x_not_approved";
  }
  return null;
}
