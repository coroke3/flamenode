import { canonicalizePermissionKey } from "../auth/permissions/aliases.ts";

/**
 * Parses the comma-separated custom permission keys of an event staff form.
 * Unknown keys reject the whole input (no silent drop); duplicates collapse.
 * Admin-only key filtering happens later, with the actor's role.
 */
export function parseEventStaffPermissionKeys(raw: string | null | undefined): string[] {
  const keys = (raw ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const invalid = keys.find((key) => !canonicalizePermissionKey(key));
  if (invalid) throw new Error(`不正な権限キーです: ${invalid}`);
  return [...new Set(keys)];
}
