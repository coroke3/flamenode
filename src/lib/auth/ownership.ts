import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventStaff,
  events as eventsTable,
  videoMembers,
  videoEvents,
  xUserAccountLinks,
  type videos,
} from "@/lib/db/schema";
import type {
  CollaboratorPermissionKey,
  VideoEditSectionKey,
} from "./videoEditSections";
import {
  VIDEO_PERMISSION_ALIASES,
  COLLABORATOR_VIDEO_EDIT_KEYS,
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  isUserDelegatableKey,
  parseDelegatablePermissionKeys,
} from "./ownershipCore";
import type { SessionUserLike } from "./ownershipCore";
import { expandPermissionAliases } from "./permissions/aliases";
import {
  getManageStaffRole,
  resolveStaffPermissionKeys,
  staffRowHasPermissionKey,
  type StaffPermissionRow,
} from "./permissions/permissionResolver";

export type { SessionUserLike };
export {
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  resolveAdminOrEventVideoPrivilegeMode,
} from "./ownershipCore";

function staffRowHasAnyPermissions(row: StaffPermissionRow): boolean {
  return resolveStaffPermissionKeys(row).size > 0;
}

const staffPermissionSelect = {
  permission_preset: eventStaff.permission_preset,
  custom_permission_keys_json: eventStaff.custom_permission_keys_json,
} as const;

export type VideoRow = typeof videos.$inferSelect;

/** 認証ユーザーに紐づく全X名義を正本リンクから解決する。 */
export async function getApprovedXIds(
  db: DB,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ x_user_id: xUserAccountLinks.x_user_id })
    .from(xUserAccountLinks)
    .where(eq(xUserAccountLinks.auth_user_id, userId));
  return Array.from(new Set(rows.map((row) => row.x_user_id)));
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
  if (user.role === "admin") return true;
  const xIds = await getApprovedXIds(db, user.id);
  if (xIds.length === 0) return false;
  const rows = await db
    .select(staffPermissionSelect)
    .from(eventStaff)
    .where(inArray(eventStaff.x_user_id, xIds));
  return rows.some((row) =>
    resolveStaffPermissionKeys(row).has("xid.link_requests"),
  );
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
  const xIds = await getApprovedXIds(db, userId);
  if (xIds.length === 0) return null;
  const staff = (
    await db
      .select(staffPermissionSelect)
      .from(eventStaff)
      .where(
        and(
          eq(eventStaff.event_id, eventId),
          inArray(eventStaff.x_user_id, xIds),
        )!,
      )
  ).find(staffRowHasAnyPermissions);
  return staff ? getManageStaffRole(staff) : null;
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

export async function canEditEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
  requiredKey: CollaboratorPermissionKey,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const candidateKeys = expandPermissionAliases(requiredKey);
  if (candidateKeys.length === 0) return false;
  const xIds = await getApprovedXIds(db, user.id);
  if (xIds.length === 0) return false;
  const rows = await db
    .select(staffPermissionSelect)
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.event_id, eventId),
        inArray(eventStaff.x_user_id, xIds),
      )!,
    );
  return rows.some((row) =>
    candidateKeys.some((key) => staffRowHasPermissionKey(row, key)),
  );
}

export async function assertCanEditEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
  requiredKey: CollaboratorPermissionKey,
): Promise<void> {
  const ok = await canEditEvent(db, user, eventId, requiredKey);
  if (!ok) throw new Error(`権限が不足しています (${requiredKey})`);
}

export type CanEditVideoPrivilegeMode = "normal" | "admin" | "event";

export async function canEditVideo(args: {
  db: DB;
  user: SessionUserLike;
  video: Pick<
    VideoRow,
    "creator_x_user_id" | "primary_event_id" | "id" | "submitted_by_user_id"
  >;
  requiredKey: VideoEditSectionKey;
  privilegeMode: CanEditVideoPrivilegeMode;
}): Promise<boolean> {
  const { db, user, video, requiredKey, privilegeMode } = args;

  if (privilegeMode === "admin" && user.role === "admin") return true;

  const approved = await getApprovedXIds(db, user.id);
  if (
    video.creator_x_user_id &&
    approved.includes(video.creator_x_user_id)
  ) {
    return true;
  }

  if (privilegeMode === "normal" && isSafeNormalVideoEditKey(requiredKey)) {
    if (user.role === "admin") return true;
    const editableEventIds = await getEditableEventIds(db, user.id);
    if (editableEventIds.length > 0) {
      const videoEventIds = new Set<string>();
      if (video.primary_event_id) videoEventIds.add(video.primary_event_id);
      const eventRows = await db
        .select({ event_id: videoEvents.event_id })
        .from(videoEvents)
        .where(eq(videoEvents.video_id, video.id));
      for (const row of eventRows) videoEventIds.add(row.event_id);
      for (const eventId of editableEventIds) {
        if (videoEventIds.has(eventId)) return true;
      }
    }
  }

  const editableMemberRows = approved.length > 0
    ? await db
        .select({ can_edit: videoMembers.can_edit })
        .from(videoMembers)
        .where(
          and(
            eq(videoMembers.video_id, video.id),
            eq(videoMembers.can_edit, 1),
            inArray(videoMembers.x_user_id, approved),
          )!,
        )
        .limit(1)
    : [];
  const isCollaborator = editableMemberRows.length > 0;

  const eventIds = new Set<string>();
  if (video.primary_event_id) eventIds.add(video.primary_event_id);
  const eventRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, video.id));
  eventRows.forEach((row) => eventIds.add(row.event_id));

  if (isCollaborator) {
    if (COLLABORATOR_VIDEO_EDIT_KEYS.has(requiredKey)) return true;
    if (
      eventIds.size > 0 &&
      isUserDelegatableKey(requiredKey) &&
      (await isEventDelegationGranted(db, eventIds, requiredKey))
    ) {
      return true;
    }
    return false;
  }

  if (privilegeMode === "normal" || privilegeMode === "admin") return false;
  if (eventIds.size === 0) return false;
  const aliases = VIDEO_PERMISSION_ALIASES[requiredKey] ?? [requiredKey];
  for (const eventId of eventIds) {
    for (const key of aliases) {
      if (
        await canEditEvent(
          db,
          user,
          eventId,
          key as CollaboratorPermissionKey,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

async function isEventDelegationGranted(
  db: DB,
  eventIds: Set<string>,
  requiredKey: VideoEditSectionKey,
): Promise<boolean> {
  const eventRows = await db
    .select({
      id: eventsTable.id,
      allow: eventsTable.allow_user_video_edits,
      json: eventsTable.user_video_edit_permission_keys_json,
    })
    .from(eventsTable)
    .where(inArray(eventsTable.id, Array.from(eventIds)));
  for (const eventRow of eventRows) {
    if (eventRow.allow !== 1) continue;
    const keys = parseDelegatablePermissionKeys(eventRow.json);
    if (keys.has(requiredKey)) return true;
  }
  return false;
}
