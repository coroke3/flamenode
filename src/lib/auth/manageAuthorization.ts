import "server-only";

import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { withDatabaseRead } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { eventStaff, xUserAccountLinks, xUsers } from "@/lib/db/schema";
import {
  expandPermissionAliases,
  getManageStaffRole,
  resolveStaffPermissionKeys,
  staffRowHasPermissionKey,
} from "@/lib/auth/permissions/permissionResolver";

/**
 * 表示用の認可スナップショットへ変換する最小 event_staff 行。
 * 書き込み認可で使う行や actor X ID はここへ持ち込まない。
 */
export type ManageAuthorizationStaffRow = {
  event_id: string;
  x_user_id: string;
  permission_preset: string | null;
  custom_permission_keys_json: string | null;
};

export type ManageAuthorizationSnapshot = {
  /** Server Component表示専用。Server Action / Route Handlerの再認可には使わない。 */
  /** 認可を解決した auth user。actor X の選択には使わない。 */
  authUserId: string;
  role: string | null;
  isAdmin: boolean;
  canAccessAdmin: boolean;
  canAccessManage: boolean;
  canManageXIdLinkRequests: boolean;
  manageableEventIds: readonly string[];
  manageStaffXUserIds: readonly string[];
  permissionsByEvent: ReadonlyMap<string, ReadonlySet<string>>;
  roleByEvent: ReadonlyMap<string, "representative" | "editor">;
};

function emptySnapshot(
  authUserId: string,
  role: string | null,
  isAdmin: boolean,
): ManageAuthorizationSnapshot {
  return {
    authUserId,
    role,
    isAdmin,
    canAccessAdmin: isAdmin,
    canAccessManage: isAdmin,
    canManageXIdLinkRequests: isAdmin,
    manageableEventIds: [],
    manageStaffXUserIds: [],
    permissionsByEvent: new Map(),
    roleByEvent: new Map(),
  };
}

/**
 * DB行をメモリ上の表示用認可へ集約する純粋処理。
 *
 * 同一イベントに複数の承認済み X ID / staff 行がある場合は、権限を
 * unionする。表示ロールは既存 getManageStaffRolesForEvents と同じく、
 * 最初に解決できた staff 行を採用し、今回の最適化で優先順位を変更しない。
 */
export function buildManageAuthorizationSnapshot(
  authUserId: string,
  role: string | null,
  rows: readonly ManageAuthorizationStaffRow[],
): ManageAuthorizationSnapshot {
  const isAdmin = role === "admin";
  if (isAdmin) return emptySnapshot(authUserId, role, true);

  const manageableEventIds = new Set<string>();
  const manageStaffXUserIds = new Set<string>();
  const permissionsByEvent = new Map<string, Set<string>>();
  const roleByEvent = new Map<string, "representative" | "editor">();
  let canManageXIdLinkRequests = false;

  for (const row of rows) {
    const eventId = row.event_id.trim();
    const xUserId = row.x_user_id.trim();
    const permissionKeys = resolveStaffPermissionKeys(row);

    // xid.link_requests は admin-only permission だが、既存の
    // resolveStaffPermissionKeys は表示/審査権限として明示付与された行を
    // 保持するため、ここでも同じ staffRowHasPermissionKey を使う。
    if (staffRowHasPermissionKey(row, "xid.link_requests")) {
      canManageXIdLinkRequests = true;
    }

    if (!eventId || permissionKeys.size === 0) continue;

    manageableEventIds.add(eventId);
    if (xUserId) manageStaffXUserIds.add(xUserId);

    const eventPermissions = permissionsByEvent.get(eventId) ?? new Set<string>();
    for (const key of permissionKeys) eventPermissions.add(key);
    permissionsByEvent.set(eventId, eventPermissions);

    if (!roleByEvent.has(eventId)) {
      const displayRole = getManageStaffRole(row);
      if (displayRole) roleByEvent.set(eventId, displayRole);
    }
  }

  return {
    authUserId,
    role,
    isAdmin: false,
    canAccessAdmin: false,
    canAccessManage: manageableEventIds.size > 0,
    canManageXIdLinkRequests,
    manageableEventIds: Array.from(manageableEventIds),
    manageStaffXUserIds: Array.from(manageStaffXUserIds),
    permissionsByEvent,
    roleByEvent,
  };
}

async function loadManageAuthorizationSnapshot(
  authUserId: string,
  role: string | null,
): Promise<ManageAuthorizationSnapshot> {
  if (role === "admin") return emptySnapshot(authUserId, role, true);

  const rows = await withDatabaseRead(async (db) => loadStaffRows(db, authUserId));
  return buildManageAuthorizationSnapshot(authUserId, role, rows ?? []);
}

async function loadStaffRows(
  db: DB,
  authUserId: string,
): Promise<ManageAuthorizationStaffRow[]> {
  return db
    .select({
      event_id: eventStaff.event_id,
      x_user_id: eventStaff.x_user_id,
      permission_preset: eventStaff.permission_preset,
      custom_permission_keys_json: eventStaff.custom_permission_keys_json,
    })
    .from(eventStaff)
    .innerJoin(
      xUserAccountLinks,
      eq(xUserAccountLinks.x_user_id, eventStaff.x_user_id),
    )
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(
      and(
        eq(xUserAccountLinks.auth_user_id, authUserId),
        eq(xUsers.approval_status, "approved"),
      )!,
    );
}

/** 同一Server Component request内だけ共有する表示用認可snapshot。 */
export const getManageAuthorizationSnapshot = cache(
  loadManageAuthorizationSnapshot,
);

export function canAccessManageEventFromSnapshot(
  snapshot: ManageAuthorizationSnapshot,
  eventId: string,
): boolean {
  return snapshot.isAdmin || snapshot.manageableEventIds.includes(eventId);
}

export function getEventPermissionsFromSnapshot(
  snapshot: ManageAuthorizationSnapshot,
  eventId: string,
): ReadonlySet<string> {
  return snapshot.permissionsByEvent.get(eventId) ?? new Set<string>();
}

export function canEditEventFromSnapshot(
  snapshot: ManageAuthorizationSnapshot,
  eventId: string,
  permissionKey: string,
): boolean {
  if (snapshot.isAdmin) return true;
  const permissions = snapshot.permissionsByEvent.get(eventId);
  if (!permissions) return false;
  return expandPermissionAliases(permissionKey).some((key) => permissions.has(key));
}

export function getManageStaffRoleFromSnapshot(
  snapshot: ManageAuthorizationSnapshot,
  eventId: string,
): "representative" | "editor" | null {
  return snapshot.roleByEvent.get(eventId) ?? null;
}

export function getManageStaffRolesFromSnapshot(
  snapshot: ManageAuthorizationSnapshot,
  eventIds?: readonly string[],
): Map<string, "representative" | "editor"> {
  if (!eventIds) return new Map(snapshot.roleByEvent);
  const wanted = new Set(eventIds);
  return new Map(
    Array.from(snapshot.roleByEvent.entries()).filter(([eventId]) =>
      wanted.has(eventId),
    ),
  );
}

export function getManageStaffXUserIdsFromSnapshot(
  snapshot: ManageAuthorizationSnapshot,
): readonly string[] {
  return snapshot.manageStaffXUserIds;
}

export function canManageXIdLinkRequestsFromSnapshot(
  snapshot: ManageAuthorizationSnapshot,
): boolean {
  return snapshot.canManageXIdLinkRequests;
}
