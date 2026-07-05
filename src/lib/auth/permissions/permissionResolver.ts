import {
  type PermissionKey,
  isAdminOnlyKey,
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

export type StaffPermissionRow = {
  permission_preset?: string | null;
  custom_permission_keys_json?: string | null;
};

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

/** preset + custom_permission_keys_json から権限キー集合を解決する。 */
export function resolveStaffPermissionKeys(
  row: StaffPermissionRow,
): Set<PermissionKey> {
  const keys = new Set<PermissionKey>();
  if (row.permission_preset === "custom") {
    for (const key of safeParseCustomPermissionKeys(
      row.custom_permission_keys_json,
      { allowAdminOnly: true },
    )) {
      keys.add(key);
    }
    return keys;
  }
  if (
    isEventStaffPreset(row.permission_preset) &&
    row.permission_preset !== "custom"
  ) {
    for (const key of getPresetPermissions(row.permission_preset)) {
      keys.add(key);
    }
  }
  return keys;
}

export function staffRowHasPermissionKey(
  row: StaffPermissionRow,
  requiredKey: string,
): boolean {
  const keys = resolveStaffPermissionKeys(row);
  return expandPermissionAliases(requiredKey).some((key) => keys.has(key));
}
