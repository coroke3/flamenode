import "server-only";

import { and, eq } from "drizzle-orm";
import { getDatabase, withDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { xAccountLinkRequests, xUsers, users } from "@/lib/db/schema";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import { resolveActiveXUserId } from "./resolveActiveXId";
import { getEditableEventIds } from "./ownership";
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
    return {
      canAccessAdmin: true,
      canAccessManage: true,
      manageableEventCount: 0,
    };
  }
  const db = getDatabase();
  if (!db) {
    return {
      canAccessAdmin: false,
      canAccessManage: false,
      manageableEventCount: 0,
    };
  }
  const manageableEventCount = (await getEditableEventIds(db, user.id)).length;
  return {
    canAccessAdmin: false,
    canAccessManage: manageableEventCount > 0,
    manageableEventCount,
  };
}

function normalizeRole(
  role: string | null | undefined,
): HeaderUser["role"] {
  return role === "admin" || role === "moderator" ? role : "user";
}

/** ヘッダー用: 明示連携済みX IDと承認待ち申請だけを返す。 */
async function fetchHeaderXIdEntries(
  db: DB,
  userId: string,
): Promise<XIdEntry[]> {
  const [linkedRows, pendingRequests] = await Promise.all([
    db
      .select({
        x_user_id: xUsers.id,
        x_name: xUsers.x_name,
        icon_url: xUsers.icon_url,
        approval_status: xUsers.approval_status,
      })
      .from(xUsers)
      .where(eq(xUsers.linked_user_id, userId)),
    db
      .select({ requested_x_id: xAccountLinkRequests.requested_x_id })
      .from(xAccountLinkRequests)
      .where(
        and(
          eq(xAccountLinkRequests.user_id, userId),
          eq(xAccountLinkRequests.status, "pending"),
        )!,
      ),
  ]);

  const byNormalizedXId = new Map<string, XIdEntry>();
  for (const row of linkedRows) {
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
    if (
      !existing ||
      xIdApprovalRank(entry.approval_status) <
        xIdApprovalRank(existing.approval_status)
    ) {
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
    entries.map((entry) => ({
      creator_x_user_id: entry.x_user_id,
      icon_url: entry.icon_url,
    })),
  );
  return entries.map((entry, index) => ({
    ...entry,
    icon_url: withIconFallback[index]?.icon_url ?? entry.icon_url,
  }));
}

export async function buildHeaderUser(
  sessionUser: SessionUserLike | null | undefined,
): Promise<HeaderUser | null> {
  if (!sessionUser?.id) return null;
  const userId = sessionUser.id;
  const fallbackRole = normalizeRole(sessionUser.role);
  const fallbackActiveXId = normalizeXId(sessionUser.active_x_user_id) || null;

  const dbPayload = await withDatabase(async (db) => {
    const [userRows, entries] = await Promise.all([
      db
        .select({
          active_x_user_id: users.active_x_user_id,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      fetchHeaderXIdEntries(db, userId),
    ]);
    const userRow = userRows[0];
    const role = normalizeRole(userRow?.role ?? sessionUser.role);
    const resolvedActive =
      (await resolveActiveXUserId(
        db,
        userId,
        normalizeXId(userRow?.active_x_user_id) || fallbackActiveXId,
      )) ?? fallbackActiveXId;
    const normalizedActive = normalizeXId(resolvedActive) || null;

    return {
      role,
      xIds: entries.map((entry) => ({
        ...entry,
        is_active:
          entry.approval_status !== "rejected" &&
          entry.x_user_id === normalizedActive,
      })),
    };
  });

  const role = dbPayload?.role ?? fallbackRole;
  const management = await getManagementAccess({ id: userId, role });
  return {
    id: userId,
    name: sessionUser.name?.trim() || "guest",
    image: sessionUser.image ?? null,
    role,
    xIds: dbPayload?.xIds ?? [],
    management: {
      canAccessAdmin: management.canAccessAdmin,
      canAccessManage: management.canAccessManage,
      manageableEventCount: management.manageableEventCount,
    },
  };
}
