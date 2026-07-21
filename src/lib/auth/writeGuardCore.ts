export const WRITE_FEATURE_KEYS = [
  "post_video_unslotted", "post_video_slotted", "edit_video",
  "like_or_bookmark", "chapter_comment", "reserve_slot", "release_slot",
  "xid_links",
  "split_slot_group", "extend_slot_group", "merge_slot_groups",
  "admin_user_role", "admin_user_ban", "admin_user_notifications",
  "admin_user_event_create", "admin_event_create", "admin_x_icon_refresh", "admin_terms_create",
  "admin_terms_update", "admin_terms_publish", "admin_terms_archive",
  "admin_terms_broadcast", "admin_moderation_create",
  "admin_moderation_update",
  "admin_announcement_broadcast",
  "admin_video_status", "admin_api_endpoints", "admin_event_templates",
  "admin_permissions", "admin_youtube_sync", "admin_notifications",
  "admin_static_rebuild", "admin_video_collab_permissions", "admin_legacy_import",
  "admin_spreadsheet",
  "manage_event_update",
  "manage_event_archive",
  "manage_slot_create",
  "manage_slot_update",
  "manage_slot_delete",
  "manage_event_staff",
  "manage_video_status",
] as const;

export type WriteFeatureKey = (typeof WRITE_FEATURE_KEYS)[number];

const WRITE_FEATURE_KEY_SET = new Set<string>(WRITE_FEATURE_KEYS);

export function isWriteFeatureKey(value: unknown): value is WriteFeatureKey {
  return typeof value === "string" && WRITE_FEATURE_KEY_SET.has(value);
}

export type CostGuardCoreDecision =
  | { blocked: false }
  | { blocked: true; reason: "mode" | "feature" };

export function evaluateCostGuardCore(input: {
  feature: WriteFeatureKey;
  operationMode: string | null;
  disabledFeaturesJson: string | null;
  exceptionUntil: number | null;
  exceptionFeaturesJson: string | null;
  now: number;
}): CostGuardCoreDecision {
  const exception = parseWriteFeatureList(input.exceptionFeaturesJson);
  if (!exception.ok || exception.features.some((item) => !isWriteFeatureKey(item))) {
    return { blocked: true, reason: "feature" };
  }
  if (
    input.exceptionUntil != null &&
    input.exceptionUntil > input.now &&
    exception.features.includes(input.feature)
  ) {
    return { blocked: false };
  }
  if (
    input.operationMode !== "normal" &&
    input.operationMode !== "economy"
  ) {
    return { blocked: true, reason: "mode" };
  }
  const disabled = parseWriteFeatureList(input.disabledFeaturesJson);
  if (
    !disabled.ok ||
    disabled.features.some((item) => !isWriteFeatureKey(item)) ||
    disabled.features.includes(input.feature)
  ) {
    return { blocked: true, reason: "feature" };
  }
  return { blocked: false };
}

export type WriteIdentity = {
  role: string;
  is_banned: number;
  is_tos_accepted: number;
  terms_reaccept_required: number;
};

export type WriteIdentityDenyReason =
  | "banned"
  | "tos_required"
  | "tos_reaccept_required"
  | "forbidden";

export function evaluateWriteIdentity(
  user: WriteIdentity,
  requiredRole?: "admin",
): WriteIdentityDenyReason | null {
  if (user.is_banned === 1) return "banned";
  if (user.is_tos_accepted !== 1) return "tos_required";
  if (user.terms_reaccept_required === 1) return "tos_reaccept_required";
  if (requiredRole === "admin" && user.role !== "admin") return "forbidden";
  return null;
}

export type ParsedWriteFeatureList =
  | { ok: true; features: readonly string[] }
  | { ok: false };

/** CostGuard configuration is fail-closed when malformed. */
export function parseWriteFeatureList(raw: string | null): ParsedWriteFeatureList {
  if (raw == null || raw === "") return { ok: true, features: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every((entry) => typeof entry === "string")
    ) {
      return { ok: true, features: value };
    }
  } catch {
    // fail-closed below
  }
  return { ok: false };
}
