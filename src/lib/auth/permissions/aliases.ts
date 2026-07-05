import { isValidPermissionKey, type PermissionKey } from "./keys.ts";

export function canonicalizePermissionKey(
  key: string,
): PermissionKey | null {
  return isValidPermissionKey(key) ? key : null;
}

export function expandPermissionAliases(key: string): PermissionKey[] {
  const canonical = canonicalizePermissionKey(key);
  return canonical ? [canonical] : [];
}
