import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventStaff,
  eventStaffPermissions,
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

  const subjectCondition =
    approvedXIds.length > 0
      ? or(
          eq(eventStaff.discord_user_id, user.id),
          inArray(eventStaff.x_user_id, approvedXIds),
        )!
      : eq(eventStaff.discord_user_id, user.id);

  const staffRows = await db
    .select({ event_id: eventStaff.event_id })
    .from(eventStaff)
    .innerJoin(
      eventStaffPermissions,
      eq(eventStaffPermissions.event_staff_id, eventStaff.id),
    )
    .where(
      and(
        eq(eventStaffPermissions.allowed, 1),
        subjectCondition,
      )!,
    );
  staffRows.forEach((row) => eventIds.add(row.event_id));

  const manageableEventIds = [...eventIds].sort();
  return {
    canAccessAdmin: false,
    canAccessManage: manageableEventIds.length > 0,
    manageableEventIds,
    manageableEventCount: manageableEventIds.length,
  };
}
