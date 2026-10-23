import type { Context } from "hono";
import type { ManageAccess, ManageStaffRole } from "@flamenode/contracts";
import {
  canonicalizePermissionKey,
  expandPermissionAliases,
  type PermissionKey,
} from "@flamenode/domain/auth/permissions";
import type { AppEnv } from "../../env.ts";
import type { SessionUser } from "../../auth/session.ts";

// CURRENT: src/lib/auth/manageAuthorization.ts (buildManageAuthorizationSnapshot, loadStaffRows),
// src/lib/auth/permissions/permissionResolver.ts and presets.ts, app/(manage)/layout.tsx (gate).
// The pure logic is copied and parity-tested against the real modules (apps/api/test/manage.parity.test.mjs).

/** ZERO_1102 S2: LIMIT <= 100. A user is staff of a handful of events (CURRENT is unbounded). */
const MAX_STAFF_ROWS = 100;

/** CURRENT PRESET_DEFINITIONS permissions per preset (src/lib/auth/permissions/presets.ts). */
export const PRESET_PERMISSIONS: Record<string, readonly PermissionKey[]> = {
  owner: [
    "event.basic", "event.publish", "event.slots", "event.members", "event.questions", "event.review",
    "event.notifications", "video.basics", "video.descriptions", "video.credits", "video.members",
    "video.member_chapters", "video.status", "video.permissions",
  ],
  manager: [
    "event.basic", "event.publish", "event.slots", "event.questions", "event.review", "event.notifications",
    "video.basics", "video.descriptions", "video.credits", "video.members", "video.member_chapters",
    "video.status", "video.permissions",
  ],
  reviewer: ["event.review", "video.status"],
  slot_manager: ["event.slots"],
  content_editor: ["video.basics", "video.descriptions", "video.credits", "video.members", "video.member_chapters"],
  xid_reviewer: ["xid.link_requests"],
  public_staff: [],
  custom: [],
};

export interface StaffPermissionRow {
  permission_preset?: string | null;
  custom_permission_keys_json?: string | null;
}

export interface ManageStaffRow extends StaffPermissionRow {
  event_id: string;
  x_user_id: string;
  active_x_user_id?: string | null;
}

function safeParseCustomPermissionKeys(json: string | null | undefined): PermissionKey[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const out = new Set<PermissionKey>();
    for (const raw of parsed) {
      if (typeof raw !== "string") continue;
      const key = canonicalizePermissionKey(raw);
      if (key) out.add(key); // CURRENT's custom branch passes allowAdminOnly: true
    }
    return Array.from(out);
  } catch {
    return [];
  }
}

/** CURRENT resolveStaffPermissionKeys (insertion order is kept: the staff page lists the keys). */
export function resolveStaffPermissionKeys(row: StaffPermissionRow): Set<PermissionKey> {
  const keys = new Set<PermissionKey>();
  if (row.permission_preset === "custom") {
    for (const key of safeParseCustomPermissionKeys(row.custom_permission_keys_json)) keys.add(key);
    return keys;
  }
  const preset = row.permission_preset;
  if (typeof preset === "string" && Object.prototype.hasOwnProperty.call(PRESET_PERMISSIONS, preset)) {
    for (const key of PRESET_PERMISSIONS[preset] ?? []) keys.add(key);
  }
  return keys;
}

function staffRowHasPermissionKey(row: StaffPermissionRow, requiredKey: string): boolean {
  const keys = resolveStaffPermissionKeys(row);
  return expandPermissionAliases(requiredKey).some((key) => keys.has(key));
}

function getManageStaffRole(row: StaffPermissionRow): ManageStaffRole | null {
  if (resolveStaffPermissionKeys(row).size === 0) return null;
  return row.permission_preset === "owner" ? "representative" : "editor";
}

export interface ManageSnapshot {
  authUserId: string;
  isAdmin: boolean;
  canAccessAdmin: boolean;
  canAccessManage: boolean;
  canManageXIdLinkRequests: boolean;
  manageableEventIds: string[];
  manageStaffXUserIds: string[];
  permissionsByEvent: Map<string, Set<string>>;
  roleByEvent: Map<string, ManageStaffRole>;
  /** More than MAX_STAFF_ROWS staff rows exist for this user; the extra rows were not read. */
  rowsTruncated: boolean;
}

function adminSnapshot(authUserId: string): ManageSnapshot {
  return {
    authUserId,
    isAdmin: true,
    canAccessAdmin: true,
    canAccessManage: true,
    canManageXIdLinkRequests: true,
    manageableEventIds: [],
    manageStaffXUserIds: [],
    permissionsByEvent: new Map(),
    roleByEvent: new Map(),
    rowsTruncated: false,
  };
}

/** CURRENT buildManageAuthorizationSnapshot. */
function buildManageSnapshot(
  authUserId: string,
  role: string | null,
  rows: readonly ManageStaffRow[],
): ManageSnapshot {
  if (role === "admin") return adminSnapshot(authUserId);
  const manageableEventIds = new Set<string>();
  const manageStaffXUserIds = new Set<string>();
  const permissionsByEvent = new Map<string, Set<string>>();
  const roleByEvent = new Map<string, ManageStaffRole>();
  const rolePriorityByEvent = new Map<string, number>();
  let canManageXIdLinkRequests = false;

  for (const row of rows) {
    const eventId = row.event_id.trim();
    const xUserId = row.x_user_id.trim();
    const permissionKeys = resolveStaffPermissionKeys(row);
    if (staffRowHasPermissionKey(row, "xid.link_requests")) canManageXIdLinkRequests = true;
    if (!eventId || permissionKeys.size === 0) continue;

    manageableEventIds.add(eventId);
    if (xUserId) manageStaffXUserIds.add(xUserId);
    const eventPermissions = permissionsByEvent.get(eventId) ?? new Set<string>();
    for (const key of permissionKeys) eventPermissions.add(key);
    permissionsByEvent.set(eventId, eventPermissions);

    const displayRole = getManageStaffRole(row);
    if (displayRole) {
      const activeXUserId = row.active_x_user_id?.trim() || null;
      const isActiveX = Boolean(xUserId && activeXUserId === xUserId);
      const displayPriority = isActiveX ? 2 : displayRole === "representative" ? 1 : 0;
      if (displayPriority > (rolePriorityByEvent.get(eventId) ?? -1)) {
        roleByEvent.set(eventId, displayRole);
        rolePriorityByEvent.set(eventId, displayPriority);
      }
    }
  }
  return {
    authUserId,
    isAdmin: false,
    canAccessAdmin: false,
    canAccessManage: manageableEventIds.size > 0,
    canManageXIdLinkRequests,
    manageableEventIds: Array.from(manageableEventIds),
    manageStaffXUserIds: Array.from(manageStaffXUserIds),
    permissionsByEvent,
    roleByEvent,
    rowsTruncated: false,
  };
}

/** CURRENT canEditEventFromSnapshot. */
export function canEditEvent(snapshot: ManageSnapshot, eventId: string, permissionKey: string): boolean {
  if (snapshot.isAdmin) return true;
  const permissions = snapshot.permissionsByEvent.get(eventId);
  if (!permissions) return false;
  return expandPermissionAliases(permissionKey).some((key) => permissions.has(key));
}

export function accessOf(snapshot: ManageSnapshot): ManageAccess {
  return {
    isAdmin: snapshot.isAdmin,
    canAccessAdmin: snapshot.canAccessAdmin,
    canAccessManage: snapshot.canAccessManage,
    canManageXIdLinkRequests: snapshot.canManageXIdLinkRequests,
  };
}

/** CURRENT loadStaffRows: ONE statement, approved linked X ids of this auth user only. Admins skip it. */
export async function loadManageSnapshot(db: D1Database, user: SessionUser): Promise<ManageSnapshot> {
  if (user.role === "admin") return adminSnapshot(user.id);
  const { results } = await db
    .prepare(
      `SELECT event_staff.event_id AS event_id, event_staff.x_user_id AS x_user_id,
         event_staff.permission_preset AS permission_preset,
         event_staff.custom_permission_keys_json AS custom_permission_keys_json,
         "user".active_x_user_id AS active_x_user_id
       FROM event_staff
       INNER JOIN x_user_account_links ON x_user_account_links.x_user_id = event_staff.x_user_id
       INNER JOIN "user" ON "user".id = x_user_account_links.auth_user_id
       INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
       WHERE x_user_account_links.auth_user_id = ? AND x_users.approval_status = 'approved'
       LIMIT ?`,
    )
    .bind(user.id, MAX_STAFF_ROWS + 1)
    .all<ManageStaffRow>();
  const snapshot = buildManageSnapshot(user.id, user.role, results.slice(0, MAX_STAFF_ROWS));
  snapshot.rowsTruncated = results.length > MAX_STAFF_ROWS;
  return snapshot;
}

/**
 * CURRENT app/(manage)/layout.tsx gate: neither admin nor event staff -> redirect("/dashboard").
 * Mapped to 403 { error: "Forbidden", reason: "manage_access_required" }. Returns the response to send, or null.
 */
export function manageGate(c: Context<AppEnv>, snapshot: ManageSnapshot): Response | null {
  if (snapshot.canAccessAdmin || snapshot.canAccessManage) return null;
  return c.json({ error: "Forbidden", reason: "manage_access_required" }, 403);
}
