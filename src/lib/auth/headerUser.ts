import "server-only";

import { and, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { xAccountLinkRequests, xUsers, users } from "@/lib/db/schema";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import {
  getManagementAccess,
  type ManagementAccess,
} from "./managementAccess";
import { resolveActiveXUserId } from "./resolveActiveXId";
import type { XIdEntry } from "@/lib/xid/entries";

export type HeaderXIdEntry = XIdEntry;

export type HeaderUser = {
  id: string;
  name: string;
  image: string | null;
  role: "user" | "admin" | "moderator";
  xIds: HeaderXIdEntry[];
  management: Pick<
    ManagementAccess,
    "canAccessAdmin" | "canAccessManage" | "manageableEventCount"
  >;
};

type SessionUserLike = {
  id?: string | null;
  name?: string | null;
  image?: string | null;
  role?: string | null;
  active_x_user_id?: string | null;
};

function normalizeRole(
  role: string | null | undefined,
): HeaderUser["role"] {
  return role === "admin" || role === "moderator" ? role : "user";
}

function normalizeApprovalStatus(
  status: string | null | undefined,
): HeaderXIdEntry["approval_status"] {
  return status === "approved" || status === "rejected" ? status : "pending";
}

function approvalRank(status: HeaderXIdEntry["approval_status"]): number {
  return status === "approved" ? 0 : status === "pending" ? 1 : 2;
}

/** ヘッダー用: 明示連携済みX IDと承認待ち申請だけを返す。 */
async function fetchHeaderXIdEntries(
  db: DB,
  userId: string,
): Promise<HeaderXIdEntry[]> {
  const linkedRows = await db
    .select({
      x_user_id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      approval_status: xUsers.approval_status,
    })
    .from(xUsers)
    .where(eq(xUsers.linked_user_id, userId));

  const byNormalizedXId = new Map<string, HeaderXIdEntry>();
  for (const row of linkedRows) {
    const normalizedId = normalizeXId(row.x_user_id);
    if (!normalizedId) continue;
    const entry: HeaderXIdEntry = {
      x_user_id: normalizedId,
      x_name: row.x_name?.trim() || `@${normalizedId}`,
      icon_url: row.icon_url,
      approval_status: normalizeApprovalStatus(row.approval_status),
      is_active: false,
    };
    const existing = byNormalizedXId.get(normalizedId);
    if (
      !existing ||
      approvalRank(entry.approval_status) < approvalRank(existing.approval_status)
    ) {
      byNormalizedXId.set(normalizedId, entry);
    }
  }

  const pendingRequests = await db
    .select({ requested_x_id: xAccountLinkRequests.requested_x_id })
    .from(xAccountLinkRequests)
    .where(
      and(
        eq(xAccountLinkRequests.user_id, userId),
        eq(xAccountLinkRequests.status, "pending"),
      )!,
    );
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

  let activeXId = normalizeXId(sessionUser.active_x_user_id) || null;
  let role = normalizeRole(sessionUser.role);
  let xIds: HeaderXIdEntry[] = [];

  const dbPayload = await withDatabase(async (db) => {
    const userRow = (
      await db
        .select({
          active_x_user_id: users.active_x_user_id,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    )[0];

    let resolvedActive = normalizeXId(userRow?.active_x_user_id) || activeXId;
    role = normalizeRole(userRow?.role ?? sessionUser.role);
    const entries = await fetchHeaderXIdEntries(db, userId);
    resolvedActive =
      (await resolveActiveXUserId(db, userId, resolvedActive)) ?? resolvedActive;
    const normalizedActive = normalizeXId(resolvedActive) || null;

    return {
      role,
      xIds: entries.map((entry) => ({
        ...entry,
        is_active:
          entry.approval_status !== "rejected" &&
          entry.x_user_id === normalizedActive,
      })),
      activeXId: resolvedActive,
    };
  });

  if (dbPayload) {
    role = dbPayload.role;
    xIds = dbPayload.xIds;
    activeXId = dbPayload.activeXId;
  }

  const management = await getManagementAccess({ id: userId, role });
  return {
    id: userId,
    name: sessionUser.name?.trim() || "guest",
    image: sessionUser.image ?? null,
    role,
    xIds,
    management: {
      canAccessAdmin: management.canAccessAdmin,
      canAccessManage: management.canAccessManage,
      manageableEventCount: management.manageableEventCount,
    },
  };
}
