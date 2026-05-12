import "server-only";

import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { users, xUsers } from "@/lib/db/schema";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";

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
  xIds: HeaderXIdEntry[];
};

type SessionUserLike = {
  id?: string | null;
  name?: string | null;
  image?: string | null;
  active_x_user_id?: string | null;
};

function normalizeApprovalStatus(
  status: string | null | undefined,
): HeaderXIdEntry["approval_status"] {
  return status === "approved" || status === "rejected" ? status : "pending";
}

export async function buildHeaderUser(
  sessionUser: SessionUserLike | null | undefined,
): Promise<HeaderUser | null> {
  if (!sessionUser?.id) return null;

  const db = getDatabase();
  let activeXId = normalizeXId(sessionUser.active_x_user_id) || null;
  const xIds: HeaderXIdEntry[] = [];

  if (db) {
    const userRow = (
      await db
        .select({ active_x_user_id: users.active_x_user_id })
        .from(users)
        .where(eq(users.id, sessionUser.id))
        .limit(1)
    )[0];
    activeXId = normalizeXId(userRow?.active_x_user_id) || activeXId;

    const rows = await db
      .select({
        x_user_id: xUsers.id,
        x_name: xUsers.x_name,
        icon_url: xUsers.icon_url,
        approval_status: xUsers.approval_status,
      })
      .from(xUsers)
      .where(eq(xUsers.linked_discord_user_id, sessionUser.id));

    const withIconFallback = await resolveMissingIcons(
      db,
      rows.map((row) => ({
        ...row,
        creator_id: row.x_user_id,
      })),
    );

    xIds.push(
      ...withIconFallback.map((row) => {
        const approvalStatus = normalizeApprovalStatus(row.approval_status);
        return {
          x_user_id: row.x_user_id,
          x_name: row.x_name,
          icon_url: row.icon_url,
          approval_status: approvalStatus,
          is_active:
            approvalStatus !== "rejected" &&
            normalizeXId(row.x_user_id) === activeXId,
        };
      }),
    );
  }

  return {
    id: sessionUser.id,
    name: sessionUser.name ?? "ゲスト",
    image: sessionUser.image ?? null,
    xIds,
  };
}
