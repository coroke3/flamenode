/**
 * Legacy compatibility bridge for ownershipCore.
 * Canonical definitions live in @flamenode/domain/video
 * (packages/domain/src/video/ownership.ts). Export surface is kept identical
 * to the pre-extraction file.
 */
export {
  type SessionUserLike,
  type VideoOwnership,
  type CanEditVideoPrivilegeMode,
  type VideoEditAccessContext,
  resolveAdminOrEventVideoPrivilegeMode,
  VIDEO_PERMISSION_ALIASES,
  resolveVideoOwnershipSync,
  adminPolicyAllows,
  creatorOwnerCanManagePermissions,
  ownerPolicyAllows,
  decideCanEditVideoFromAccessContext,
  eventStaffCandidatePermissionKeys,
  resolveEventPermissionFromAccessContext,
  canUseEventPrivilegeFromAccessContext,
  shouldWarnManageActiveXMismatch,
} from "@flamenode/domain/video";
