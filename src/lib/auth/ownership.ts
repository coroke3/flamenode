import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventStaff,
  events as eventsTable,
  videoMembers,
  videoEvents,
  type videos,
} from "@/lib/db/schema";
import type {
  CollaboratorPermissionKey,
  VideoEditSectionKey,
} from "./videoEditSections";
import {
  VIDEO_PERMISSION_ALIASES,
  decideCanEditVideo,
  resolveOwnerGeneralPolicyKeys,
  resolveVideoOwnershipSync,
  type CanEditVideoPrivilegeMode,
  type VideoOwnership,
} from "./ownershipCore";
import type { SessionUserLike } from "./ownershipCore";
import {
  loadGeneralEditableFieldSet,
  sectionAllowedByGeneralFields,
  type GeneralEditableFieldKey,
} from "@/lib/video/generalEditPermissions";
import { getApprovedLinkedXUserIds } from "./approvedX";
import { expandPermissionAliases } from "./permissions/aliases";
import {
  getManageStaffRole,
  resolveStaffPermissionKeys,
  staffRowHasPermissionKey,
  type StaffPermissionRow,
} from "./permissions/permissionResolver";

export type { SessionUserLike, VideoOwnership, CanEditVideoPrivilegeMode };
export {
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  resolveAdminOrEventVideoPrivilegeMode,
  resolveVideoOwnershipSync,
  decideCanEditVideo,
  resolveOwnerGeneralPolicyKeys,
  adminPolicyAllows,
  ownerGeneralPolicyAllows,
} from "./ownershipCore";

function staffRowHasAnyPermissions(row: StaffPermissionRow): boolean {
  return resolveStaffPermissionKeys(row).size > 0;
}

const staffPermissionSelect = {
  permission_preset: eventStaff.permission_preset,
  custom_permission_keys_json: eventStaff.custom_permission_keys_json,
} as const;

export type VideoRow = typeof videos.$inferSelect;

/** 認証ユーザーに紐づく承認済みX名義を正本リンクから解決する。imported は含めない。 */
export async function getApprovedXIds(
  db: DB,
  authUserId: string,
): Promise<string[]> {
  return getApprovedLinkedXUserIds(db, authUserId);
}

/**
 * 作品所有者判定の正本。
 * - 作者: creator_x_user_id ∈ 承認済み X ID
 * - 合作所有者: video_members.can_edit = 1 かつ x_user_id ∈ 承認済み X ID
 * submitted_by_user_id / active X のみ / イベント参加者等は使わない。
 */
export async function resolveVideoOwnership(args: {
  db: DB;
  userId: string;
  video: Pick<VideoRow, "id" | "creator_x_user_id">;
  approvedXUserIds?: readonly string[];
}): Promise<VideoOwnership> {
  const approved =
    args.approvedXUserIds ?? (await getApprovedXIds(args.db, args.userId));
  let hasCollaboratorEdit = false;
  if (approved.length > 0) {
    const rows = await args.db
      .select({ id: videoMembers.id })
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, args.video.id),
          eq(videoMembers.can_edit, 1),
          inArray(videoMembers.x_user_id, Array.from(approved)),
        )!,
      )
      .limit(1);
    hasCollaboratorEdit = rows.length > 0;
  }
  return resolveVideoOwnershipSync({
    approvedXUserIds: approved,
    creatorXUserId: args.video.creator_x_user_id,
    hasCollaboratorEdit,
  });
}

/** 自分が編集者として担当しているイベント ID 一覧。 */
export async function getEditableEventIds(
  db: DB,
  userId: string,
  candidateEventIds?: readonly string[],
): Promise<string[]> {
  const xIds = await getApprovedXIds(db, userId);
  if (xIds.length === 0) return [];
  const candidateIds = candidateEventIds
    ? Array.from(new Set(candidateEventIds.filter(Boolean)))
    : null;
  if (candidateIds && candidateIds.length === 0) return [];
  const rowsQuery = db
    .select({
      event_id: eventStaff.event_id,
      ...staffPermissionSelect,
    })
    .from(eventStaff)
    .where(
      candidateIds
        ? and(
            inArray(eventStaff.x_user_id, xIds),
            inArray(eventStaff.event_id, candidateIds),
          )!
        : inArray(eventStaff.x_user_id, xIds),
    );
  const rows = candidateIds
    ? await rowsQuery.limit(candidateIds.length * 4 + 1)
    : await rowsQuery;
  if (candidateIds && rows.length > candidateIds.length * 4) {
    throw new Error("editable_event_staff_read_limit_exceeded");
  }
  return Array.from(
    new Set(rows.filter(staffRowHasAnyPermissions).map((row) => row.event_id)),
  );
}

/** 当該イベントで自分が持つ permission_key 一覧。 */
export async function getCollaboratorPermissions(
  db: DB,
  userId: string,
  eventId: string,
): Promise<Set<string>> {
  const xIds = await getApprovedXIds(db, userId);
  if (xIds.length === 0) return new Set();
  const rows = await db
    .select(staffPermissionSelect)
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.event_id, eventId),
        inArray(eventStaff.x_user_id, xIds),
      )!,
    );
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of resolveStaffPermissionKeys(row)) keys.add(key);
  }
  return keys;
}

export async function canManageXIdLinkRequests(
  db: DB,
  user: SessionUserLike,
): Promise<boolean> {
  return (await resolveXIdLinkRequestAuthorization(db, user)).allowed;
}

export type XAuthorizationEvidence = {
  allowed: boolean;
  /** 実際に権限を成立させた X。Auth user role で成立した場合は null。 */
  actorXUserId: string | null;
};

function pickAuthorizationXUserId(
  rows: readonly { x_user_id: string }[],
  preferredXUserId: string | null | undefined,
): string | null {
  const ids = Array.from(new Set(rows.map((row) => row.x_user_id.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
  const preferred = preferredXUserId?.trim() || null;
  return preferred && ids.includes(preferred) ? preferred : ids[0] ?? null;
}

/** X ID 審査権限と、その認可に実際に使った X 名義を同時に返す。 */
export async function resolveXIdLinkRequestAuthorization(
  db: DB,
  user: SessionUserLike,
): Promise<XAuthorizationEvidence> {
  if (user.role === "admin") return { allowed: true, actorXUserId: null };
  const xIds = await getApprovedXIds(db, user.id);
  if (xIds.length === 0) return { allowed: false, actorXUserId: null };
  const rows = await db
    .select({ x_user_id: eventStaff.x_user_id, ...staffPermissionSelect })
    .from(eventStaff)
    .where(inArray(eventStaff.x_user_id, xIds));
  const authorizedRows = rows.filter((row) =>
    resolveStaffPermissionKeys(row).has("xid.link_requests"),
  );
  const actorXUserId = pickAuthorizationXUserId(
    authorizedRows,
    user.active_x_user_id,
  );
  return { allowed: actorXUserId !== null, actorXUserId };
}

export async function canAccessManageEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const editable = await getEditableEventIds(db, user.id, [eventId]);
  return editable.includes(eventId);
}

/** 担当イベントごとの event_staff 権限プリセットを表示用ロールへ変換する。 */
export async function getManageStaffRoleForEvent(
  db: DB,
  userId: string,
  eventId: string,
): Promise<"representative" | "editor" | null> {
  const roles = await getManageStaffRolesForEvents(db, userId, [eventId]);
  return roles.get(eventId) ?? null;
}

/** 担当イベントごとの表示用ロールを単一読取で取得する。 */
export async function getManageStaffRolesForEvents(
  db: DB,
  userId: string,
  eventIds: string[],
): Promise<Map<string, "representative" | "editor">> {
  const roles = new Map<string, "representative" | "editor">();
  if (eventIds.length === 0) return roles;
  const xIds = await getApprovedXIds(db, userId);
  if (xIds.length === 0) return roles;
  const rows = await db
    .select({
      event_id: eventStaff.event_id,
      ...staffPermissionSelect,
    })
    .from(eventStaff)
    .where(
      and(
        inArray(eventStaff.event_id, eventIds),
        inArray(eventStaff.x_user_id, xIds),
      )!,
    );
  for (const row of rows) {
    if (!staffRowHasAnyPermissions(row)) continue;
    if (roles.has(row.event_id)) continue;
    const role = getManageStaffRole(row);
    if (!role) continue;
    roles.set(row.event_id, role);
  }
  return roles;
}

/** 担当イベントに紐づく運営用 X ID 一覧。 */
export async function getManageStaffXUserIds(
  db: DB,
  userId: string,
  eventIds: string[],
): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const xIds = await getApprovedXIds(db, userId);
  if (xIds.length === 0) return [];
  const rows = await db
    .select({ x_user_id: eventStaff.x_user_id, ...staffPermissionSelect })
    .from(eventStaff)
    .where(
      and(
        inArray(eventStaff.event_id, eventIds),
        inArray(eventStaff.x_user_id, xIds),
      )!,
    );
  return Array.from(
    new Set(
      rows
        .filter(staffRowHasAnyPermissions)
        .map((row) => row.x_user_id.trim())
        .filter(Boolean),
    ),
  );
}

export { shouldWarnManageActiveXMismatch } from "./ownershipCore";

/**
 * イベント運営の manage 用権限判定。
 * site admin は manage 画面入場のため true。作品編集の event モードでは
 * eventStaffHasExactVideoPermission を使う (admin 自動許可なし)。
 */
export async function canEditEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
  requiredKey: CollaboratorPermissionKey,
): Promise<boolean> {
  return (await resolveEventEditAuthorization(db, user, eventId, requiredKey)).allowed;
}

/** イベント権限と、その認可に実際に使った X 名義を同時に返す。 */
export async function resolveEventEditAuthorization(
  db: DB,
  user: SessionUserLike,
  eventId: string,
  requiredKey: CollaboratorPermissionKey,
): Promise<XAuthorizationEvidence> {
  if (user.role === "admin") return { allowed: true, actorXUserId: null };
  const candidateKeys = expandPermissionAliases(requiredKey);
  if (candidateKeys.length === 0) {
    return { allowed: false, actorXUserId: null };
  }
  const xIds = await getApprovedXIds(db, user.id);
  if (xIds.length === 0) return { allowed: false, actorXUserId: null };
  const rows = await db
    .select({ x_user_id: eventStaff.x_user_id, ...staffPermissionSelect })
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.event_id, eventId),
        inArray(eventStaff.x_user_id, xIds),
      )!,
    );
  const authorizedRows = rows.filter((row) =>
    candidateKeys.some((key) => staffRowHasPermissionKey(row, key)),
  );
  const actorXUserId = pickAuthorizationXUserId(
    authorizedRows,
    user.active_x_user_id,
  );
  return { allowed: actorXUserId !== null, actorXUserId };
}

export async function assertCanEditEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
  requiredKey: CollaboratorPermissionKey,
): Promise<string | null> {
  const evidence = await resolveEventEditAuthorization(
    db,
    user,
    eventId,
    requiredKey,
  );
  if (!evidence.allowed) throw new Error(`権限が不足しています (${requiredKey})`);
  return evidence.actorXUserId;
}

async function loadVideoEventIds(
  db: DB,
  video: Pick<VideoRow, "id" | "primary_event_id">,
): Promise<string[]> {
  const ids = new Set<string>();
  if (video.primary_event_id) ids.add(video.primary_event_id);
  const rows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, video.id));
  for (const row of rows) ids.add(row.event_id);
  return Array.from(ids);
}

/**
 * 作品に紐づくイベントのうち、対象 permission key を持つスタッフ行があるか。
 * site admin でも event_staff 行と具体キーが無ければ false (権限源を混ぜない)。
 */
export async function resolveEventStaffVideoPermissionGrant(args: {
  db: DB;
  user: SessionUserLike;
  video: Pick<VideoRow, "id" | "primary_event_id">;
  requiredKey: VideoEditSectionKey;
  approvedXUserIds?: readonly string[];
}): Promise<{ allowed: boolean; eventId?: string }> {
  const approved =
    args.approvedXUserIds ??
    (await getApprovedXIds(args.db, args.user.id));
  if (approved.length === 0) return { allowed: false };

  const eventIds = await loadVideoEventIds(args.db, args.video);
  if (eventIds.length === 0) return { allowed: false };

  const aliases = VIDEO_PERMISSION_ALIASES[args.requiredKey] ?? [
    args.requiredKey,
  ];
  const candidateKeys = new Set<string>();
  for (const alias of aliases) {
    for (const key of expandPermissionAliases(alias)) candidateKeys.add(key);
  }
  if (candidateKeys.size === 0) return { allowed: false };

  const rows = await args.db
    .select({
      event_id: eventStaff.event_id,
      ...staffPermissionSelect,
    })
    .from(eventStaff)
    .where(
      and(
        inArray(eventStaff.event_id, eventIds),
        inArray(eventStaff.x_user_id, Array.from(approved)),
      )!,
    );

  // primary_event を優先し、なければ最初にマッチしたイベントを権限元とする。
  const orderedIds = [
    ...(args.video.primary_event_id && eventIds.includes(args.video.primary_event_id)
      ? [args.video.primary_event_id]
      : []),
    ...eventIds.filter((id) => id !== args.video.primary_event_id),
  ];
  for (const eventId of orderedIds) {
    const eventRows = rows.filter((row) => row.event_id === eventId);
    const allowed = eventRows.some((row) =>
      Array.from(candidateKeys).some((key) =>
        staffRowHasPermissionKey(row, key),
      ),
    );
    if (allowed) return { allowed: true, eventId };
  }
  return { allowed: false };
}

export async function eventStaffHasExactVideoPermission(args: {
  db: DB;
  user: SessionUserLike;
  video: Pick<VideoRow, "id" | "primary_event_id">;
  requiredKey: VideoEditSectionKey;
  approvedXUserIds?: readonly string[];
}): Promise<boolean> {
  const grant = await resolveEventStaffVideoPermissionGrant(args);
  return grant.allowed;
}

async function loadPrimaryEventOwnerPolicy(
  db: DB,
  primaryEventId: string | null | undefined,
): Promise<Set<string>> {
  if (!primaryEventId) {
    return resolveOwnerGeneralPolicyKeys({ primaryEvent: null });
  }
  const row = (
    await db
      .select({
        allow_user_video_edits: eventsTable.allow_user_video_edits,
        user_video_edit_permission_keys_json:
          eventsTable.user_video_edit_permission_keys_json,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, primaryEventId))
      .limit(1)
  )[0];
  return resolveOwnerGeneralPolicyKeys({ primaryEvent: row ?? null });
}

/**
 * 作品編集可否の正本。
 * 優先順位: admin モード → event モード → normal (所有者 + 一般作品権限)。
 * 権限源の混在・自動フォールバックはしない。
 */
export async function canEditVideo(args: {
  db: DB;
  user: SessionUserLike;
  video: Pick<
    VideoRow,
    | "creator_x_user_id"
    | "primary_event_id"
    | "id"
    | "submitted_by_user_id"
    | "visibility_status"
  >;
  requiredKey: VideoEditSectionKey;
  privilegeMode: CanEditVideoPrivilegeMode;
  generalFields?: Set<GeneralEditableFieldKey>;
}): Promise<boolean> {
  const { db, user, video, requiredKey, privilegeMode, generalFields } = args;
  const approved = await getApprovedXIds(db, user.id);
  const ownership = await resolveVideoOwnership({
    db,
    userId: user.id,
    video,
    approvedXUserIds: approved,
  });

  if (privilegeMode === "normal") {
    if (!ownership.isOwner) return false;

    if (requiredKey === "video.identity") {
      const fields =
        generalFields ?? (await loadGeneralEditableFieldSet(db, video));
      return sectionAllowedByGeneralFields(requiredKey, fields);
    }

    if (requiredKey === "video.permissions") {
      return decideCanEditVideo({
        privilegeMode,
        userRole: user.role,
        ownership,
        requiredKey,
        ownerPolicyKeys: new Set(),
        eventStaffAllows: false,
      });
    }
  }

  let ownerPolicyKeys: Set<string> = new Set();
  let eventStaffAllows = false;

  if (privilegeMode === "normal") {
    ownerPolicyKeys = await loadPrimaryEventOwnerPolicy(
      db,
      video.primary_event_id,
    );
  } else if (privilegeMode === "event") {
    eventStaffAllows = await eventStaffHasExactVideoPermission({
      db,
      user,
      video,
      requiredKey,
      approvedXUserIds: approved,
    });
  }

  const allowed = decideCanEditVideo({
    privilegeMode,
    userRole: user.role,
    ownership,
    requiredKey,
    ownerPolicyKeys,
    eventStaffAllows,
  });
  if (!allowed) return false;

  if (privilegeMode !== "normal") return true;

  const fields =
    generalFields ?? (await loadGeneralEditableFieldSet(db, video));
  return sectionAllowedByGeneralFields(requiredKey, fields);
}

/**
 * イベント運営モード切替 UI 用。
 * 対象作品のいずれかの編集セクションを event モードで編集できるときだけ true。
 * event_staff 行の存在だけでは true にしない。
 */
export async function canUseEventPrivilegeModeForVideo(args: {
  db: DB;
  user: SessionUserLike;
  video: Pick<
    VideoRow,
    | "creator_x_user_id"
    | "primary_event_id"
    | "id"
    | "submitted_by_user_id"
    | "visibility_status"
  >;
}): Promise<boolean> {
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
  for (const key of probeKeys) {
    if (
      await canEditVideo({
        ...args,
        requiredKey: key,
        privilegeMode: "event",
      })
    ) {
      return true;
    }
  }
  return false;
}
