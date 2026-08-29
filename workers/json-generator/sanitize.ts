const FORBIDDEN = new Set([
  "submitted_by_user_id",
  "user_id",
  "actor_user_id",
  "operator_user_id",
  "approved_by_user_id",
  "recipient_user_id",
  "reserved_by_user_id",
  "discord_id",
  "internal_note",
  "private_note",
  "approval_status",
  "access_token",
  "is_active",
  "is_entry_open",
  "is_archived",
  "custom_questions",
  "stage_permission",
  "required_video_fields_json",
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
