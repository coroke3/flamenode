/**
 * Legacy compatibility bridge for permissions/aliases.
 * Canonical definitions live in @flamenode/domain/auth/permissions
 * (packages/domain/src/auth/permissions/aliases.ts).
 */
export {
  LEGACY_PERMISSION_KEY_ALIASES,
  canonicalizePermissionKey,
  expandPermissionAliases,
} from "@flamenode/domain/auth/permissions";
