import "server-only";

import { getDatabase } from "@/lib/cloudflare";
import { getEditableEventIds } from "./ownership";

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

  const manageableEventIds = (
    await getEditableEventIds(db, user.id)
  ).sort();
  return {
    canAccessAdmin: false,
    canAccessManage: manageableEventIds.length > 0,
    manageableEventIds,
    manageableEventCount: manageableEventIds.length,
  };
}
