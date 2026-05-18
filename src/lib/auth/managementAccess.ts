import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventCollaboratorPermissions,
  eventEditors,
} from "@/lib/db/schema";
import { getApprovedXIds } from "./ownership";

export type ManagementAccess = {
  canAccessAdmin: boolean;
  canAccessManage: boolean;
  manageableEventIds: string[];
  manageableEventCount: number;
};

export function emptyManagementAccess(): ManagementAccess {
  return {
    canAccessAdmin: false,
    canAccessManage: false,
    manageableEventIds: [],
    manageableEventCount: 0,
  };
}

export async function getManagementAccess(user: {
  id: string;
  role?: string | null;
}): Promise<ManagementAccess> {
  if (user.role === "admin") {
    return {
      canAccessAdmin: true,
      canAccessManage: true,
      manageableEventIds: [],
      manageableEventCount: 0,
    };
  }

  const db = getDatabase();
  if (!db) return emptyManagementAccess();

  const approvedXIds = await getApprovedXIds(db, user.id);
  const eventIds = new Set<string>();

  if (approvedXIds.length > 0) {
    const editorRows = await db
      .select({ event_id: eventEditors.event_id })
      .from(eventEditors)
      .where(inArray(eventEditors.x_user_id, approvedXIds));
    editorRows.forEach((row) => eventIds.add(row.event_id));
  }

  const subjectCondition =
    approvedXIds.length > 0
      ? or(
          eq(eventCollaboratorPermissions.discord_user_id, user.id),
          inArray(eventCollaboratorPermissions.x_user_id, approvedXIds),
        )!
      : eq(eventCollaboratorPermissions.discord_user_id, user.id);

  const collaboratorRows = await db
    .select({ event_id: eventCollaboratorPermissions.event_id })
    .from(eventCollaboratorPermissions)
    .where(
      and(
        eq(eventCollaboratorPermissions.allowed, 1),
        subjectCondition,
      )!,
    );
  collaboratorRows.forEach((row) => eventIds.add(row.event_id));

  const manageableEventIds = [...eventIds].sort();
  return {
    canAccessAdmin: false,
    canAccessManage: manageableEventIds.length > 0,
    manageableEventIds,
    manageableEventCount: manageableEventIds.length,
  };
}
