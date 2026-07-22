/** 公開 API ホワイトリスト DTO。 */

export const PUBLIC_VIDEO_KEYS = [
  "id",
  "title",
  "youtube_video_id",
  "display_name",
  "icon_url",
  "primary_event_id",
  "scheduled_time",
  "status",
] as const;

export interface PublicVideoDto {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string | null;
  icon_url: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
  status: "public";
}

/** /api/events が返してよい列のキー。 */
export const PUBLIC_EVENT_KEYS = [
  "id",
  "title",
  "event_type",
  "explanation",
  "icon_url",
  "img_url",
  "accent_color",
  "visibility_status",
  "slot_type",
  "slot_visibility_mode",
  "start_time",
  "end_time",
  "entry_start_time",
  "entry_end_time",
  "max_slots_per_video",
] as const;

export interface PublicEventDto {
  id: string;
  title: string;
  event_type: "event" | "collabo" | "type" | "other" | null;
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  visibility_status: "public";
  slot_type: "time" | "count" | null;
  slot_visibility_mode: "public_name" | "anonymous" | "hidden" | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  max_slots_per_video: number;
}

/** /api/software/suggestions が返してよい列のキー。 */
export const PUBLIC_SOFTWARE_SUGGESTION_KEYS = [
  "id",
  "name",
  "category",
  "usage_count",
  "is_verified",
] as const;

export interface PublicSoftwareSuggestionDto {
  id: string;
  name: string;
  category: string | null;
  usage_count: number;
  is_verified: number;
}

export interface PublicSoftwareSuggestionSource
  extends PublicSoftwareSuggestionDto {
  is_active: number;
}

/**
 * DB条件の退行時にもinactiveな辞書項目を公開しないためのDTO境界。
 */
export function toPublicSoftwareSuggestionDto(
  source: PublicSoftwareSuggestionSource,
): PublicSoftwareSuggestionDto | null {
  if (source.is_active !== 1) return null;
  return pickKeys(source, PUBLIC_SOFTWARE_SUGGESTION_KEYS);
}

export const FORBIDDEN_PUBLIC_KEYS: ReadonlySet<string> = new Set([
  "submitted_by_user_id",
  "auth_user_id",
  "requested_by_auth_user_id",
  "approved_by_auth_user_id",
  "created_by_request_id",
  "parent_request_id",
  "restore_snapshot_json",
  "revert_deadline_at",
  "creator_x_user_id",
  "user_id",
  "actor_user_id",
  "operator_user_id",
  "approved_by_user_id",
  "recipient_user_id",
  "reserved_by_user_id",
  "discord_id",
  "active_x_user_id",
  "email",
  "email_verified",
  "verification_token",
  "access_token",
  "refresh_token",
  "id_token",
  "session_token",
  "providerAccountId",
  "role",
  "permission_preset",
  "custom_permission_keys_json",
  "is_banned",
  "tos_accepted_at",
  "tos_version",
  "internal_note",
  "private_note",
  "void_detail_private",
  "history_logs",
  "audit_logs",
  "notification_payload",
  "representative_x_user_id",
  "public_api_updated_at",
  "max_consecutive_slots_per_entry",
  "priority_reclaim_video_id",
  "priority_reclaim_until",
  "slot_kind",
  "sort_order",
  "is_active",
  "is_entry_open",
  "is_archived",
  "custom_questions",
  "stage_permission",
]);

export const MAX_PUBLIC_LIST_LIMIT = 48;
export const MAX_PUBLIC_EVENT_LIMIT = 60;
export const MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT = 50;

export function pickKeys<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}

export interface ForbiddenPublicKeyViolation {
  path: string;
  key: string;
}

function collectForbiddenPublicKeys(
  value: unknown,
  path: string,
  violations: ForbiddenPublicKeyViolation[],
  limit: number,
): void {
  if (
    violations.length >= limit ||
    value === null ||
    value === undefined
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectForbiddenPublicKeys(
        value[index],
        `${path}[${index}]`,
        violations,
        limit,
      );
      if (violations.length >= limit) return;
    }
    return;
  }
  if (typeof value !== "object") return;

  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) {
      violations.push({ path: `${path}.${key}`, key });
      if (violations.length >= limit) return;
    }
    collectForbiddenPublicKeys(
      nested,
      `${path}.${key}`,
      violations,
      limit,
    );
    if (violations.length >= limit) return;
  }
}

export function findForbiddenPublicKeys(
  value: unknown,
  path: string = "$",
): ForbiddenPublicKeyViolation[] {
  const violations: ForbiddenPublicKeyViolation[] = [];
  collectForbiddenPublicKeys(
    value,
    path,
    violations,
    Number.POSITIVE_INFINITY,
  );
  return violations;
}

export function assertNoForbiddenKeys(
  value: unknown,
  path: string = "$",
): void {
  const violations: ForbiddenPublicKeyViolation[] = [];
  collectForbiddenPublicKeys(value, path, violations, 1);
  const first = violations[0];
  if (!first) return;
  throw new Error(
    `Public API leak: forbidden key "${first.key}" at ${first.path}`,
  );
}
