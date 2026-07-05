/**
 * @deprecated number bitmask は廃止。migration backfill 専用に残す。
 * 通常コードは permissionResolver.ts を使うこと。
 */
import {
  ALL_PERMISSION_KEYS,
  type PermissionKey,
} from "./keys.ts";
import type { EventStaffPreset } from "./presets.ts";
import { getPresetPermissions } from "./presets.ts";
import { normalizePermissionKeys } from "./permissionResolver.ts";

export {
  expandPermissionAliases,
  normalizePermissionKeys,
  safeParseCustomPermissionKeys,
  resolveStaffPermissionKeys,
  staffRowHasPermissionKey,
  type StaffPermissionRow,
} from "./permissionResolver.ts";

export const MAX_PERMISSION_KEYS_FOR_NUMBER_MASK = 45;

function permissionBit(key: PermissionKey): number {
  const index = ALL_PERMISSION_KEYS.indexOf(key);
  if (index < 0) return 0;
  return 2 ** index;
}

/** migration backfill 専用。 */
export function permissionMaskToKeys(mask: number | null | undefined): PermissionKey[] {
  const numericMask = Number(mask ?? 0);
  if (!Number.isFinite(numericMask) || numericMask <= 0) return [];
  const keys: PermissionKey[] = [];
  for (const key of ALL_PERMISSION_KEYS) {
    const bit = permissionBit(key);
    if (Math.floor(numericMask / bit) % 2 === 1) keys.push(key);
  }
  return keys;
}

/** migration backfill 専用。 */
export function keysToPermissionMask(
  keys: readonly string[],
  options: { allowAdminOnly?: boolean } = {},
): number {
  let mask = 0;
  for (const key of normalizePermissionKeys(keys, options)) {
    mask += permissionBit(key);
  }
  return mask;
}

export function presetToPermissionMask(
  preset: EventStaffPreset,
  options: { allowAdminOnly?: boolean } = {},
): number {
  return keysToPermissionMask(getPresetPermissions(preset), options);
}
