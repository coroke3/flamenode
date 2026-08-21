import "server-only";

import { and, eq } from "drizzle-orm";
import { getDatabase, withDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { xIdentityRequests, users } from "@/lib/db/schema";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import { resolveActiveXUserId } from "./resolveActiveXId";
import { getEditableEventIds } from "./ownership";
import { getEditableEventIdsByApprovedXIds } from "./editableEventIdsByXIds";
import {
  getHeaderLinkedXUsersForAuthUser,
  type HeaderLinkedXUser,
} from "./headerLinkedXUsers";
import {
  normalizeXIdApprovalStatus,
  xIdApprovalRank,
  type XIdEntry,
} from "@/lib/xid/entries";

export type HeaderUser = {
  id: string;
  name: string;
  image: string | null;
  role: "user" | "admin" | "moderator";
  xIds: XIdEntry[];
  management: {
    canAccessAdmin: boolean;
    canAccessManage: boolean;
    manageableEventCount: number;
  };
};

export type AuthoritativeHeaderUserSnapshot = {
  role?: string | null;
  active_x_user_id?: string | null;
};

export type BuildHeaderUserOptions = {
  includeXIds?: boolean;
  /**
   * 同一requestで getCurrentUser() 等がDB正本から取得済みの値だけを渡す。
   * Auth.js sessionやクライアント入力を正本扱いする用途では使わない。
   */
  authoritativeUserSnapshot?: AuthoritativeHeaderUserSnapshot;
};

type SessionUserLike = {
  id?: string | null;
  name?: string | null;
  image?: string | null;
  role?: string | null;
  active_x_user_id?: string | null;
};

function adminManagement(): HeaderUser["management"] {
  return { canAccessAdmin: true, canAccessManage: true, manageableEventCount: 0 };
}

function userManagement(manageableEventCount: number): HeaderUser["management"] {
  return {
    canAccessAdmin: false,
    canAccessManage: manageableEventCount > 0,
    manageableEventCount,
  };
}

async function getManagementAccess(user: {
  id: string;
  role?: string | null;
}): Promise<HeaderUser["management"]> {
  if (user.role === "admin") return adminManagement();
  const db = getDatabase();
  if (!db) return userManagement(0);
  const manageableEventCount = (await getEditableEventIds(db, user.id)).length;
  return userManagement(manageableEventCount);
}

async function getManagementAccessFromApprovedXIds(
  db: DB,
  role: HeaderUser["role"],
  approvedXUserIds: readonly string[],
): Promise<HeaderUser["management"]> {
  if (role === "admin") return adminManagement();
  const manageableEventCount = (
    await getEditableEventIdsByApprovedXIds(db, approvedXUserIds)
  ).length;
  return userManagement(manageableEventCount);
}

function normalizeRole(role: string | null | undefined): HeaderUser["role"] {
  return role === "admin" || role === "moderator" ? role : "user";
}

async function fetchHeaderXIdEntries(
  db: DB,
  authUserId: string,
  linkedRows?: readonly HeaderLinkedXUser[],
): Promise<XIdEntry[]> {
  const [resolvedLinkedRows, pendingRequests] = await Promise.all([
    linkedRows
      ? Promise.resolve(linkedRows)
      : getHeaderLinkedXUsersForAuthUser(db, authUserId),
    db
      .select({ requested_x_id: xIdentityRequests.requested_x_id })
      .from(xIdentityRequests)
      .where(
        and(
          eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
          eq(xIdentityRequests.status, "pending"),
        )!,
      ),
  ]);

  const byNormalizedXId = new Map<string, XIdEntry>();
  for (const row of resolvedLinkedRows) {
    const normalizedId = normalizeXId(row.x_user_id);
    if (!normalizedId) continue;
    const entry: XIdEntry = {
      x_user_id: normalizedId,
      x_name: row.x_name?.trim() || `@${normalizedId}`,
      icon_url: row.icon_url,
      approval_status: normalizeXIdApprovalStatus(row.approval_status),
      is_active: false,
    };
    const existing = byNormalizedXId.get(normalizedId);
    if (!existing || xIdApprovalRank(entry.approval_status) < xIdApprovalRank(existing.approval_status)) {
      byNormalizedXId.set(normalizedId, entry);
    }
  }

  for (const request of pendingRequests) {
    const normalizedId = normalizeXId(request.requested_x_id);
    if (!normalizedId || byNormalizedXId.has(normalizedId)) continue;
    byNormalizedXId.set(normalizedId, {
      x_user_id: normalizedId,
      x_name: `@${normalizedId}`,
      icon_url: null,
      approval_status: "pending",
      is_active: false,
    });
  }

  const entries = Array.from(byNormalizedXId.values());
  const withIconFallback = await resolveMissingIcons(
    db,
    entries.map((entry) => ({ creator_x_user_id: entry.x_user_id, icon_url: entry.icon_url })),
  );
  return entries.map((entry, index) => ({
    ...entry,
    icon_url: withIconFallback[index]?.icon_url ?? entry.icon_url,
  }));
}

async function resolveAuthoritativeUserSnapshot(
  db: DB,
  authUserId: string,
  provided?: AuthoritativeHeaderUserSnapshot,
): Promise<AuthoritativeHeaderUserSnapshot> {
  if (provided) return provided;
  const row = (
    await db
      .select({ active_x_user_id: users.active_x_user_id, role: users.role })
      .from(users)
      .where(eq(users.id, authUserId))
      .limit(1)
  )[0];
  return row ?? {};
}

export async function buildHeaderUser(
  sessionUser: SessionUserLike | null | undefined,
  options?: BuildHeaderUserOptions,
): Promise<HeaderUser | null> {
  if (!sessionUser?.id) return null;
  const authUserId = sessionUser.id;
  const fallbackRole = normalizeRole(sessionUser.role);
  const fallbackActiveXId = normalizeXId(sessionUser.active_x_user_id) || null;
  const includeXIds = options?.includeXIds !== false;

  const dbPayload = includeXIds
    ? await withDatabase(async (db) => {
        const linkedRows = await getHeaderLinkedXUsersForAuthUser(db, authUserId);
        const [userRow, entries] = await Promise.all([
          resolveAuthoritativeUserSnapshot(
            db,
            authUserId,
            options?.authoritativeUserSnapshot,
          ),
          fetchHeaderXIdEntries(db, authUserId, linkedRows),
        ]);
        const role = normalizeRole(userRow.role ?? sessionUser.role);
        const approvedLinkedRows = linkedRows.filter(
          (row) => row.approval_status === "approved",
        );
        const approvedXUserIds = Array.from(
          new Set(approvedLinkedRows.map((row) => row.x_user_id)),
        );
        const [resolvedActive, management] = await Promise.all([
          resolveActiveXUserId(
            db,
            authUserId,
            normalizeXId(userRow.active_x_user_id) || fallbackActiveXId,
            approvedLinkedRows,
          ),
          getManagementAccessFromApprovedXIds(db, role, approvedXUserIds),
        ]);
        const normalizedActive = normalizeXId(resolvedActive) || null;
        return {
          role,
          xIds: entries.map((entry) => ({
            ...entry,
            is_active:
              entry.approval_status !== "rejected" && entry.x_user_id === normalizedActive,
          })),
          management,
        };
      })
    : await withDatabase(async (db) => {
        const userRow = await resolveAuthoritativeUserSnapshot(
          db,
          authUserId,
          options?.authoritativeUserSnapshot,
        );
        return {
          role: normalizeRole(userRow.role ?? sessionUser.role),
          xIds: [] as XIdEntry[],
          management: null,
        };
      });

  const role = dbPayload?.role ?? fallbackRole;
  const management =
    dbPayload?.management ?? (await getManagementAccess({ id: authUserId, role }));
  return {
    id: authUserId,
    name: sessionUser.name?.trim() || "guest",
    image: sessionUser.image ?? null,
    role,
    xIds: dbPayload?.xIds ?? [],
    management,
  };
}
