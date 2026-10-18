/**
 * Legacy compatibility bridge for permissions/keys.
 * Canonical permission key registry lives in @flamenode/domain/auth/permissions
 * (packages/domain/src/auth/permissions/keys.ts). Do not add keys here.
 */
export {
  type EventPermissionKey,
  type VideoPermissionKey,
  type PermissionKey,
  type PermissionCategory,
  type PermissionDefinition,
  EVENT_PERMISSION_KEYS,
  VIDEO_PERMISSION_KEYS,
  ALL_PERMISSION_KEYS,
  DANGEROUS_PERMISSION_KEYS,
  PERMISSION_DEFINITIONS,
  isDangerousKey,
  isAdminOnlyKey,
  isValidPermissionKey,
} from "@flamenode/domain/auth/permissions";
