/**
 * ownership.ts の純粋ロジック (DB / server-only 依存を含まない部分)。
 * テスト容易性のため ownership.ts から切り出している。
 */

import type { VideoEditSectionKey } from "./videoEditSections";
import { expandPermissionAliases } from "./permissions/aliases.ts";
import {
  sectionAllowedByGeneralFields,
  type GeneralEditableFieldKey,
} from "../video/generalEditPermissionsCore.ts";

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
  /** event ID ごとの event_staff 正規権限キー（resolveStaffPermissionKeys の和集合）。 */
  eventPermissionKeysByEvent: ReadonlyMap<string, ReadonlySet<string>>;
};

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

/**
 * 通常モード: 所有者だけが、作者の共同編集権限管理か一般作品権限の field で許可される。
 * DB 経路（canEditVideo）と request-local context 経路で共有する。
 */
export function ownerPolicyAllows(
  ownership: VideoOwnership,
  requiredKey: VideoEditSectionKey,
  ownerEditableFields: ReadonlySet<GeneralEditableFieldKey>,
): boolean {
  if (!ownership.isOwner) return false;
  if (creatorOwnerCanManagePermissions(ownership, requiredKey)) return true;
  return sectionAllowedByGeneralFields(requiredKey, ownerEditableFields);
}

/** Pure section decision using a request-local context. */
export function decideCanEditVideoFromAccessContext(args: {
  context: VideoEditAccessContext;
  userRole: string | null | undefined;
  requiredKey: VideoEditSectionKey;
  privilegeMode: CanEditVideoPrivilegeMode;
}): boolean {
  const { context, userRole, requiredKey, privilegeMode } = args;
  if (privilegeMode === "admin") return adminPolicyAllows(userRole, requiredKey);
  if (privilegeMode === "event") {
    return resolveEventPermissionFromAccessContext(context, requiredKey).allowed;
  }
  if (privilegeMode === "normal") {
    return ownerPolicyAllows(context.ownership, requiredKey, context.ownerEditableFields);
  }
  return false;
}

/**
 * event_staff が requiredKey を満たすために持つべき正規権限キー。
 * DB 経路（eventStaffHasExactVideoPermission）と request-local context 経路で共有する。
 */
export function eventStaffCandidatePermissionKeys(
  requiredKey: VideoEditSectionKey,
): Set<string> {
  const keys = new Set<string>();
  for (const alias of VIDEO_PERMISSION_ALIASES[requiredKey] ?? [requiredKey]) {
    for (const key of expandPermissionAliases(alias)) keys.add(key);
  }
  return keys;
}

export function resolveEventPermissionFromAccessContext(
  context: VideoEditAccessContext,
  requiredKey: VideoEditSectionKey,
): { allowed: true; eventId: string } | { allowed: false } {
  const candidateKeys = Array.from(eventStaffCandidatePermissionKeys(requiredKey));
  for (const eventId of context.currentEventIds) {
    const keys = context.eventPermissionKeysByEvent.get(eventId);
    if (keys && candidateKeys.some((key) => keys.has(key))) {
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
