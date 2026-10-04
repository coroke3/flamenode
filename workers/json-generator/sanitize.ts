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

/** 最初の禁止keyまでのpath（`[0].user_id` 形式）。通常の全走査ではpath文字列を作らない。 */
function forbiddenKeyPath(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) continue;
      const found = forbiddenKeyPath(value[i]);
      if (found !== null) return `[${i}]${found}`;
    }
    return null;
  }
  const row = value as Record<string, unknown>;
  for (const k of Object.keys(row)) {
    if (FORBIDDEN.has(k)) return `.${k}`;
    const found = forbiddenKeyPath(row[k]);
    if (found !== null) return `.${k}${found}`;
  }
  return null;
}

export function assertNoForbiddenPublicKeys(value: unknown, path = "root"): void {
  const found = forbiddenKeyPath(value);
  if (found !== null) throw new Error(`Forbidden key ${path}${found}`);
}
