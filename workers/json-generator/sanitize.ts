const FORBIDDEN = new Set([
  "submitted_by_discord_user_id",
  "operator_discord_id",
  "discord_user_id",
  "discord_id",
  "internal_note",
  "private_note",
  "approval_status",
  "access_token",
]);

export function assertNoForbiddenPublicKeys(value: unknown, path = "root"): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbiddenPublicKeys(v, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(k)) {
      throw new Error(`Forbidden key ${path}.${k}`);
    }
    assertNoForbiddenPublicKeys(child, `${path}.${k}`);
  }
}
