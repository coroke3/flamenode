export type WriteFeatureKey =
  | "post_video_unslotted"
  | "post_video_slotted"
  | "edit_video"
  | "like_or_bookmark"
  | "chapter_comment"
  | "reserve_slot"
  | "release_slot"
  | "split_slot_group"
  | "extend_slot_group"
  | "merge_slot_groups"
  | "admin_user_role"
  | "admin_user_ban"
  | "admin_user_notifications"
  | "admin_user_event_create"
  | "admin_x_icon_refresh"
  | "admin_terms_create"
  | "admin_terms_update"
  | "admin_terms_publish"
  | "admin_terms_archive"
  | "admin_terms_broadcast"
  | "admin_moderation_create"
  | "admin_moderation_update";

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
