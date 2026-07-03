import {
  ALL_PERMISSION_KEYS,
  isAdminOnlyKey,
  type PermissionKey,
} from "./keys.ts";
import {
  canonicalizePermissionKey,
  expandPermissionAliases,
} from "./aliases.ts";
import {
  getPresetPermissions,
  type EventStaffPreset,
} from "./presets.ts";

export { expandPermissionAliases };

export const MAX_PERMISSION_KEYS_FOR_NUMBER_MASK = 45;

export type StaffPermissionRow = {
  permission_mask?: number | null;
  permission_preset?: string | null;
  custom_permission_keys_json?: string | null;
};

export function assertPermissionMaskCapacity(): void {
  if (ALL_PERMISSION_KEYS.length > MAX_PERMISSION_KEYS_FOR_NUMBER_MASK) {
    throw new Error(
      `permission key count ${ALL_PERMISSION_KEYS.length} exceeds safe Number mask limit ${MAX_PERMISSION_KEYS_FOR_NUMBER_MASK}`,
    );
  }
}

function permissionBit(key: PermissionKey): number {
  assertPermissionMaskCapacity();
  const index = ALL_PERMISSION_KEYS.indexOf(key);
  if (index < 0) return 0;
  return 2 ** index;
}

export function normalizePermissionKeys(
  keys: readonly string[],
  options: { allowAdminOnly?: boolean } = {},
): PermissionKey[] {
  const out = new Set<PermissionKey>();
  for (const raw of keys) {
    const key = canonicalizePermissionKey(raw);
    if (!key) continue;
    if (!options.allowAdminOnly && isAdminOnlyKey(key)) continue;
    out.add(key);
  }
  return Array.from(out);
}

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

export function hasPermission(
  mask: number | null | undefined,
  key: string,
): boolean {
  const canonical = canonicalizePermissionKey(key);
  if (!canonical) return false;
  const bit = permissionBit(canonical);
  const numericMask = Number(mask ?? 0);
  if (!Number.isFinite(numericMask) || numericMask <= 0) return false;
  return Math.floor(numericMask / bit) % 2 === 1;
}

export function presetToPermissionMask(
  preset: EventStaffPreset,
  options: { allowAdminOnly?: boolean } = {},
): number {
  return keysToPermissionMask(getPresetPermissions(preset), options);
}

function isEventStaffPreset(value: string | null | undefined): value is EventStaffPreset {
  return (
    value === "owner" ||
    value === "manager" ||
    value === "slot_manager" ||
    value === "content_editor" ||
    value === "reviewer" ||
    value === "xid_reviewer" ||
    value === "public_staff" ||
    value === "custom"
  );
}

export function safeParseCustomPermissionKeys(
  json: string | null | undefined,
  options: { allowAdminOnly?: boolean } = {},
): PermissionKey[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return normalizePermissionKeys(
      parsed.filter((v): v is string => typeof v === "string"),
      options,
    );
  } catch {
    return [];
  }
}

export function resolveStaffPermissionKeys(
  row: StaffPermissionRow,
): Set<PermissionKey> {
  const keys = new Set<PermissionKey>(permissionMaskToKeys(row.permission_mask));
  if (row.permission_preset === "custom") {
    for (const key of safeParseCustomPermissionKeys(
      row.custom_permission_keys_json,
      { allowAdminOnly: true },
    )) {
      keys.add(key);
    }
  }
  if (
    keys.size === 0 &&
    isEventStaffPreset(row.permission_preset) &&
    row.permission_preset !== "custom"
  ) {
    for (const key of getPresetPermissions(row.permission_preset)) {
      keys.add(key);
    }
  }
  return keys;
}
