import "server-only";

import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { users, xUsers } from "@/lib/db/schema";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import {
  emptyManagementAccess,
  getManagementAccess,
  type ManagementAccess,
} from "./managementAccess";

export type HeaderXIdEntry = {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: "approved" | "pending" | "rejected";
  is_active: boolean;
};

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

function normalizeApprovalStatus(
  status: string | null | undefined,
): HeaderXIdEntry["approval_status"] {
  return status === "approved" || status === "rejected" ? status : "pending";
}

function normalizeRole(
  role: string | null | undefined,
): HeaderUser["role"] {
  return role === "admin" || role === "moderator" ? role : "user";
}

function approvalRank(status: HeaderXIdEntry["approval_status"]): number {
  return status === "approved" ? 0 : status === "pending" ? 1 : 2;
}

export async function buildHeaderUser(
  sessionUser: SessionUserLike | null | undefined,
): Promise<HeaderUser | null> {
  if (!sessionUser?.id) return null;
  const userId: string = sessionUser.id;

  const db = getDatabase();
  let activeXId = normalizeXId(sessionUser.active_x_user_id) || null;
  let role = normalizeRole(sessionUser.role);
  let management = emptyManagementAccess();
  const xIds: HeaderXIdEntry[] = [];

  if (db) {
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
    activeXId = normalizeXId(userRow?.active_x_user_id) || activeXId;
    role = normalizeRole(userRow?.role ?? sessionUser.role);

    const rows = await db
      .select({
        x_user_id: xUsers.id,
        x_name: xUsers.x_name,
        icon_url: xUsers.icon_url,
        approval_status: xUsers.approval_status,
      })
      .from(xUsers)
      .where(eq(xUsers.linked_discord_user_id, userId));

    const withIconFallback = await resolveMissingIcons(
      db,
      rows.map((row) => ({
        ...row,
        creator_x_user_id: row.x_user_id,
      })),
    );

    const byNormalizedXId = new Map<string, HeaderXIdEntry>();
    for (const row of withIconFallback) {
      const normalizedId = normalizeXId(row.x_user_id);
      if (!normalizedId) continue;
      const approvalStatus = normalizeApprovalStatus(row.approval_status);
      const entry: HeaderXIdEntry = {
        x_user_id: normalizedId,
        x_name: row.x_name,
        icon_url: row.icon_url,
        approval_status: approvalStatus,
        is_active:
          approvalStatus !== "rejected" &&
          normalizedId === activeXId,
      };
      const existing = byNormalizedXId.get(normalizedId);
      if (
        !existing ||
        entry.is_active ||
        approvalRank(entry.approval_status) < approvalRank(existing.approval_status)
      ) {
        byNormalizedXId.set(normalizedId, entry);
      }
    }

    xIds.push(...Array.from(byNormalizedXId.values()));
  }

  management = await getManagementAccess({ id: sessionUser.id, role });

  return {
    id: sessionUser.id,
    name: sessionUser.name ?? "ゲスト",
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
