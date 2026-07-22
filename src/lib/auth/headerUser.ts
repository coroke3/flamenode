import "server-only";

import { and, eq } from "drizzle-orm";
import { getDatabase, withDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { xIdentityRequests, users } from "@/lib/db/schema";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import { resolveActiveXUserId } from "./resolveActiveXId";
import { getEditableEventIds } from "./ownership";
import { getLinkedXUsersForAuthUser, type LinkedXUser } from "./xIdentity";
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

export type BuildHeaderUserOptions = {
  includeXIds?: boolean;
};

type SessionUserLike = {
  id?: string | null;
  name?: string | null;
  image?: string | null;
  role?: string | null;
  active_x_user_id?: string | null;
};

async function getManagementAccess(user: {
  id: string;
  role?: string | null;
}): Promise<HeaderUser["management"]> {
  if (user.role === "admin") {
    return { canAccessAdmin: true, canAccessManage: true, manageableEventCount: 0 };
  }
  const db = getDatabase();
  if (!db) return { canAccessAdmin: false, canAccessManage: false, manageableEventCount: 0 };
  const manageableEventCount = (await getEditableEventIds(db, user.id)).length;
  return {
    canAccessAdmin: false,
    canAccessManage: manageableEventCount > 0,
    manageableEventCount,
  };
}

function normalizeRole(role: string | null | undefined): HeaderUser["role"] {
  return role === "admin" || role === "moderator" ? role : "user";
}

async function fetchHeaderXIdEntries(
  db: DB,
  authUserId: string,
  linkedRows?: LinkedXUser[],
): Promise<XIdEntry[]> {
  const [resolvedLinkedRows, pendingRequests] = await Promise.all([
    linkedRows ? Promise.resolve(linkedRows) : getLinkedXUsersForAuthUser(db, authUserId),
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
        const linkedRows = await getLinkedXUsersForAuthUser(db, authUserId);
        const [userRows, entries] = await Promise.all([
          db
            .select({ active_x_user_id: users.active_x_user_id, role: users.role })
            .from(users)
            .where(eq(users.id, authUserId))
            .limit(1),
          fetchHeaderXIdEntries(db, authUserId, linkedRows),
        ]);
        const userRow = userRows[0];
        const role = normalizeRole(userRow?.role ?? sessionUser.role);
        const approvedLinkedRows = linkedRows.filter(
          (row) => row.approval_status === "approved",
        );
        const resolvedActive = await resolveActiveXUserId(
          db,
          authUserId,
          normalizeXId(userRow?.active_x_user_id) || fallbackActiveXId,
          approvedLinkedRows,
        );
        const normalizedActive = normalizeXId(resolvedActive) || null;
        return {
          role,
          xIds: entries.map((entry) => ({
            ...entry,
            is_active:
              entry.approval_status !== "rejected" && entry.x_user_id === normalizedActive,
          })),
        };
      })
    : await withDatabase(async (db) => {
        const userRows = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, authUserId))
          .limit(1);
        return {
          role: normalizeRole(userRows[0]?.role ?? sessionUser.role),
          xIds: [] as XIdEntry[],
        };
      });

  const role = dbPayload?.role ?? fallbackRole;
  const management = await getManagementAccess({ id: authUserId, role });
  return {
    id: authUserId,
    name: sessionUser.name?.trim() || "guest",
    image: sessionUser.image ?? null,
    role,
    xIds: dbPayload?.xIds ?? [],
    management,
  };
}
