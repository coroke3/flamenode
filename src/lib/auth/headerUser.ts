import "server-only";

import { eq } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { users } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import {
  getManagementAccess,
  type ManagementAccess,
} from "./managementAccess";
import { resolveActiveXUserId } from "./resolveActiveXId";
import {
  applyActiveXIdToEntries,
  fetchHeaderXIdEntries,
} from "./headerXIds";
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

function fallbackName(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

export async function buildHeaderUser(
  sessionUser: SessionUserLike | null | undefined,
): Promise<HeaderUser | null> {
  if (!sessionUser?.id) return null;
  const userId: string = sessionUser.id;

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

    let resolvedActive =
      normalizeXId(userRow?.active_x_user_id) || activeXId;
    role = normalizeRole(userRow?.role ?? sessionUser.role);

    const entries = await fetchHeaderXIdEntries(db, userId, resolvedActive);
    resolvedActive =
      (await resolveActiveXUserId(db, userId, resolvedActive)) ?? resolvedActive;

    return {
      role,
      xIds: applyActiveXIdToEntries(entries, resolvedActive),
      activeXId: resolvedActive,
    };
  });

  if (dbPayload) {
    role = dbPayload.role;
    xIds = dbPayload.xIds;
    activeXId = dbPayload.activeXId;
  }

  const management = await getManagementAccess({ id: sessionUser.id, role });

  return {
    id: sessionUser.id,
    name: fallbackName(sessionUser.name, "guest"),
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
