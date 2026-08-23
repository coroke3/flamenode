/**
 * ownership.ts の純粋ロジック (DB / server-only 依存を含まない部分)。
 * テスト容易性のため ownership.ts から切り出している。
 */

import type { VideoEditSectionKey } from "./videoEditSections";
import type { GeneralEditableFieldKey } from "../video/generalEditPermissionsCore.ts";

export type SessionUserLike = {
  id: string;
  role?: string | null;
  active_x_user_id?: string | null;
};

export type VideoOwnership = {
  isCreatorOwner: boolean;
  isCollaboratorOwner: boolean;
  isOwner: boolean;
};

export type CanEditVideoPrivilegeMode = "normal" | "admin" | "event";

/** Request-local authorization snapshot. Never store this in module/global cache. */
export type VideoEditAccessContext = {
  userId: string;
  videoId: string;
  approvedXUserIds: readonly string[];
  ownership: VideoOwnership;
  currentEventIds: readonly string[];
  ownerEditableFields: ReadonlySet<GeneralEditableFieldKey>;
  eventPermissionKeysByEvent: ReadonlyMap<string, ReadonlySet<string>>;
};

function ownerFieldAllowsSection(
  sectionKey: VideoEditSectionKey,
  fields: ReadonlySet<GeneralEditableFieldKey>,
): boolean {
  switch (sectionKey) {
    case "video.basics":
    case "videos.title":
      return fields.has("title") || fields.has("part");
    case "video.identity":
      return ["display_name", "icon_url", "profile_text", "youtube_channel_url", "other_social_links"]
        .some((key) => fields.has(key as GeneralEditableFieldKey));
    case "video.credits":
    case "videos.music_credit":
      return fields.has("music") || fields.has("music_reference_url") || fields.has("credit");
    case "video.descriptions":
    case "videos.review_data":
      return ["intro_comment", "used_software", "highlights", "production_story", "closing_comment", "custom_answers", "stage_permission"]
        .some((key) => fields.has(key as GeneralEditableFieldKey));
    case "video.members":
    case "videos.members":
      return fields.has("members") || fields.has("is_collab");
    case "video.member_chapters":
      return fields.has("chapters");
    case "video.youtube_id":
    case "videos.youtube_id":
      return fields.has("youtube_url");
    case "video.primary_event":
    case "videos.primary_event":
      return fields.has("event_ids");
    default:
      return false;
  }
}

/**
 * admin と event の両方を許可する画面・操作でも、一度の判定では権限源を混ぜない。
 * admin 以外に admin 特権を与えず、admin を event 権限へ暗黙fallbackさせない。
 */
export function resolveAdminOrEventVideoPrivilegeMode(
  role: string | null | undefined,
): "admin" | "event" {
  return role === "admin" ? "admin" : "event";
}

export const VIDEO_PERMISSION_ALIASES: Record<
  VideoEditSectionKey,
  readonly string[]
> = {
  "video.basics": ["video.basics", "videos.title"],
  "video.identity": ["video.identity"],
  "video.descriptions": ["video.descriptions", "videos.review_data"],
  "video.credits": ["video.credits", "videos.music_credit"],
  "video.members": ["video.members", "videos.members"],
  "video.member_chapters": [
    "video.member_chapters",
    "video.members",
    "videos.members",
  ],
  "video.youtube_id": ["video.youtube_id", "videos.youtube_id"],
  "video.primary_event": ["video.primary_event", "videos.primary_event"],
  "video.status": ["video.status"],
  "video.chapter_admin": ["video.chapter_admin", "video.member_chapters"],
  "video.permissions": ["video.permissions"],
  "videos.title": ["videos.title", "video.basics"],
  "videos.music_credit": ["videos.music_credit", "video.credits"],
  "videos.members": ["videos.members", "video.members"],
  "videos.review_data": ["videos.review_data", "video.descriptions"],
  "videos.youtube_id": ["videos.youtube_id", "video.youtube_id"],
  "videos.primary_event": ["videos.primary_event", "video.primary_event"],
};

/**
 * privilegeMode = "admin" 時に解放される危険キー（参考用ホワイトリスト）。
 * 管理者モードでは既知キーをすべて許可する (adminPolicyAllows)。
 */
export const DANGEROUS_ADMIN_VIDEO_EDIT_KEYS = new Set<VideoEditSectionKey>([
  "video.identity",
  "video.youtube_id",
  "video.primary_event",
  "video.status",
  "video.chapter_admin",
  "video.permissions",
  "videos.youtube_id",
  "videos.primary_event",
]);

/**
 * 一般作品権限 (所有者向け) に含められるキーのホワイトリスト。
 * ここに無いキーはイベント設定 JSON に書かれていても無視する (fail-closed)。
 * 危険キー (identity / youtube_id / primary_event / status / chapter_admin /
 * permissions) は含めない。
 */
export const OWNER_GENERAL_POLICY_WHITELIST = new Set<string>([
  "youtube_url",
  "videos.title",
  "videos.music_credit",
  "videos.members",
  "videos.review_data",
  "video.basics",
  "video.descriptions",
  "video.credits",
  "video.members",
  "video.member_chapters",
]);

/** @deprecated 旧名。OWNER_GENERAL_POLICY_WHITELIST を使う。 */
export const USER_DELEGATABLE_KEYS = OWNER_GENERAL_POLICY_WHITELIST;

/**
 * primary_event が無い、または allow_user_video_edits = 0 のときの
 * デフォルト所有者ポリシー (fail-closed の明示セット)。
 */
export const DEFAULT_OWNER_GENERAL_POLICY_KEYS = new Set<VideoEditSectionKey>([
  "video.basics",
  "video.descriptions",
  "video.credits",
  "video.members",
  "video.member_chapters",
  "videos.title",
  "videos.review_data",
  "videos.music_credit",
  "videos.members",
]);

/**
 * 旧合作メンバー既定キー。DEFAULT_OWNER_GENERAL_POLICY_KEYS と同等の意味に統一。
 * @deprecated DEFAULT_OWNER_GENERAL_POLICY_KEYS を使う。
 */
export const COLLABORATOR_VIDEO_EDIT_KEYS = DEFAULT_OWNER_GENERAL_POLICY_KEYS;

/**
 * 旧「通常モードでスタッフが触れる safe key」。スタッフ通常モード経路は削除済み。
 * 互換のため DEFAULT と同趣旨のセットを残す。
 * @deprecated
 */
export const NORMAL_SAFE_VIDEO_EDIT_KEYS = DEFAULT_OWNER_GENERAL_POLICY_KEYS;

export function resolveVideoOwnershipSync(args: {
  approvedXUserIds: readonly string[];
  creatorXUserId: string | null | undefined;
  hasCollaboratorEdit: boolean;
}): VideoOwnership {
  const creator = args.creatorXUserId?.trim() || null;
  const isCreatorOwner = Boolean(
    creator && args.approvedXUserIds.includes(creator),
  );
  const isCollaboratorOwner = args.hasCollaboratorEdit === true;
  return {
    isCreatorOwner,
    isCollaboratorOwner,
    isOwner: isCreatorOwner || isCollaboratorOwner,
  };
}

/** 管理者モード: サイト管理者なら既知の作品編集キーを許可。 */
export function adminPolicyAllows(
  userRole: string | null | undefined,
  requiredKey: VideoEditSectionKey,
): boolean {
  if (userRole !== "admin") return false;
  return Object.prototype.hasOwnProperty.call(
    VIDEO_PERMISSION_ALIASES,
    requiredKey,
  );
}

export function ownerGeneralPolicyAllows(
  policyKeys: ReadonlySet<string>,
  requiredKey: VideoEditSectionKey,
): boolean {
  if (requiredKey === "video.youtube_id" || requiredKey === "videos.youtube_id") {
    return policyKeys.has("youtube_url");
  }
  // 危険キーは一般作品権限では絶対に許可しない (タイトル等のエイリアス経由も不可)。
  if (DANGEROUS_ADMIN_VIDEO_EDIT_KEYS.has(requiredKey)) return false;
  if (!OWNER_GENERAL_POLICY_WHITELIST.has(requiredKey)) return false;
  if (policyKeys.has(requiredKey)) return true;
  const aliases = VIDEO_PERMISSION_ALIASES[requiredKey] ?? [requiredKey];
  return aliases.some(
    (alias) =>
      OWNER_GENERAL_POLICY_WHITELIST.has(alias) && policyKeys.has(alias),
  );
}

/**
 * 作者所有者のみ、通常モードで共同編集権限管理を常に許可する。
 * 合作所有者への無制限再委譲を防ぐ。提出主体 (video.identity) とは分離する。
 */
export function creatorOwnerCanManagePermissions(
  ownership: VideoOwnership,
  requiredKey: VideoEditSectionKey,
): boolean {
  return ownership.isCreatorOwner && requiredKey === "video.permissions";
}

export function decideCanEditVideo(args: {
  privilegeMode: CanEditVideoPrivilegeMode;
  userRole: string | null | undefined;
  ownership: VideoOwnership;
  requiredKey: VideoEditSectionKey;
  ownerPolicyKeys: ReadonlySet<string>;
  eventStaffAllows: boolean;
}): boolean {
  const {
    privilegeMode,
    userRole,
    ownership,
    requiredKey,
    ownerPolicyKeys,
    eventStaffAllows,
  } = args;

  if (privilegeMode === "admin") {
    return adminPolicyAllows(userRole, requiredKey);
  }

  if (privilegeMode === "event") {
    return eventStaffAllows === true;
  }

  if (privilegeMode === "normal") {
    if (!ownership.isOwner) return false;
    if (creatorOwnerCanManagePermissions(ownership, requiredKey)) return true;
    return ownerGeneralPolicyAllows(ownerPolicyKeys, requiredKey);
  }

  return false;
}

/** Pure section decision using a request-local context. */
export function decideCanEditVideoFromAccessContext(args: {
  context: VideoEditAccessContext;
  userRole: string | null | undefined;
  requiredKey: VideoEditSectionKey;
  privilegeMode: CanEditVideoPrivilegeMode;
}): boolean {
  const { context, userRole, requiredKey, privilegeMode } = args;
  if (privilegeMode === "admin") {
    return adminPolicyAllows(userRole, requiredKey);
  }
  if (privilegeMode === "normal") {
    if (!context.ownership.isOwner) return false;
    if (creatorOwnerCanManagePermissions(context.ownership, requiredKey)) return true;
    return ownerFieldAllowsSection(requiredKey, context.ownerEditableFields);
  }
  return Boolean(resolveEventPermissionFromAccessContext(context, requiredKey));
}

export function resolveEventPermissionFromAccessContext(
  context: VideoEditAccessContext,
  requiredKey: VideoEditSectionKey,
): { allowed: true; eventId: string } | { allowed: false } {
  const aliases = VIDEO_PERMISSION_ALIASES[requiredKey] ?? [requiredKey];
  for (const eventId of context.currentEventIds) {
    const keys = context.eventPermissionKeysByEvent.get(eventId);
    if (keys && aliases.some((alias) => keys.has(alias))) {
      return { allowed: true, eventId };
    }
  }
  return { allowed: false };
}

export function canUseEventPrivilegeFromAccessContext(
  context: VideoEditAccessContext,
): boolean {
  const probeKeys: VideoEditSectionKey[] = [
    "video.basics",
    "video.descriptions",
    "video.credits",
    "video.members",
    "video.member_chapters",
    "video.status",
    "video.permissions",
    "video.identity",
    "video.youtube_id",
    "video.primary_event",
    "video.chapter_admin",
  ];
  return probeKeys.some((requiredKey) =>
    decideCanEditVideoFromAccessContext({
      context,
      userRole: null,
      requiredKey,
      privilegeMode: "event",
    }),
  );
}

export function isSafeNormalVideoEditKey(key: VideoEditSectionKey): boolean {
  return NORMAL_SAFE_VIDEO_EDIT_KEYS.has(key);
}

export function isDangerousAdminVideoEditKey(
  key: VideoEditSectionKey,
): boolean {
  return DANGEROUS_ADMIN_VIDEO_EDIT_KEYS.has(key);
}

export function isUserDelegatableKey(key: VideoEditSectionKey | string): boolean {
  return OWNER_GENERAL_POLICY_WHITELIST.has(key);
}

export function isOwnerGeneralPolicyKey(key: string): boolean {
  return OWNER_GENERAL_POLICY_WHITELIST.has(key);
}

/**
 * Active X が運営権限の付与先 X と食い違うとき true（注意表示用）。
 * 運営入場判定には使わない。
 */
export function shouldWarnManageActiveXMismatch(
  activeXUserId: string | null | undefined,
  manageStaffXUserIds: readonly string[],
): boolean {
  const activeX = activeXUserId?.trim() || null;
  if (!activeX) return false;
  if (manageStaffXUserIds.length === 0) return false;
  return !manageStaffXUserIds.includes(activeX);
}

export function parseDelegatablePermissionKeys(
  raw: string | null | undefined,
): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) {
      if (typeof v === "string" && OWNER_GENERAL_POLICY_WHITELIST.has(v)) {
        out.add(v);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

/**
 * primary_event の設定から所有者向け一般作品権限キーを解決する。
 * allow !== 1 またはイベント無し → デフォルトポリシー。
 * allow === 1 → JSON ホワイトリストのみ (空なら何も許可しない)。
 */
export function resolveOwnerGeneralPolicyKeys(args: {
  primaryEvent:
    | {
        allow_user_video_edits: number | null | undefined;
        user_video_edit_permission_keys_json: string | null | undefined;
      }
    | null
    | undefined;
}): Set<string> {
  const event = args.primaryEvent;
  if (!event || event.allow_user_video_edits !== 1) {
    return new Set(DEFAULT_OWNER_GENERAL_POLICY_KEYS);
  }
  return parseDelegatablePermissionKeys(
    event.user_video_edit_permission_keys_json,
  );
}
