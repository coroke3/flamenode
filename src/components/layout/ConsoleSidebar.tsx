import * as React from "react";
import { desc, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  getEditableEventIds,
  getManageStaffXUserIds,
  canManageXIdLinkRequests,
  shouldWarnManageActiveXMismatch,
} from "@/lib/auth/ownership";
import { events as eventsTable } from "@/lib/db/schema";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";
import { AdminSidebarNav } from "@/components/admin/AdminSidebarNav";
import { AdminModeBanner } from "@/components/admin/AdminModeBanner";
import { ManageModeBanner } from "@/components/manage/ManageModeBanner";
import { buildAdminNavGroups } from "@/lib/admin/adminNavGroups";
import { ManageSidebarNav } from "./ManageSidebarNav";

/**
 * /admin と /manage で共通の左ナビ。
 * シェル構造を揃え、画面遷移時にサイドバー位置がずれないようにする。
 */
export async function ConsoleSidebar({
  consoleMode,
}: {
  consoleMode: "admin" | "manage";
}): Promise<React.ReactElement | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  const db = getDatabase();
  if (!db) return null;

  const isAdmin = u.role === "admin";
  const canManage =
    isAdmin ||
    (await getEditableEventIds(db, u.id)).length > 0 ||
    (await canManageXIdLinkRequests(db, { id: u.id, role: u.role ?? null }));

  if (!isAdmin && !canManage) return null;

  const editableEventIds = isAdmin ? [] : await getEditableEventIds(db, u.id);

  const events =
    isAdmin
      ? await db
          .select({
            id: eventsTable.id,
            title: eventsTable.title,
            accent_color: eventsTable.accent_color,
            visibility_status: eventsTable.visibility_status,
            start_time: eventsTable.start_time,
            end_time: eventsTable.end_time,
            entry_start_time: eventsTable.entry_start_time,
            entry_end_time: eventsTable.entry_end_time,
          })
          .from(eventsTable)
          .orderBy(
            desc(eventsTable.start_time),
            desc(eventsTable.created_at),
            desc(eventsTable.id),
          )
          .then((rows) => rows.sort(compareEventsByUpcomingPriority))
      : editableEventIds.length > 0
        ? await db
            .select({
              id: eventsTable.id,
              title: eventsTable.title,
              accent_color: eventsTable.accent_color,
              visibility_status: eventsTable.visibility_status,
              start_time: eventsTable.start_time,
              end_time: eventsTable.end_time,
              entry_start_time: eventsTable.entry_start_time,
              entry_end_time: eventsTable.entry_end_time,
            })
            .from(eventsTable)
            .where(inArray(eventsTable.id, editableEventIds))
            .orderBy(
              desc(eventsTable.start_time),
              desc(eventsTable.created_at),
              desc(eventsTable.id),
            )
            .then((rows) => rows.sort(compareEventsByUpcomingPriority))
        : [];

  const activeX = u.active_x_user_id?.trim() || null;
  const manageStaffXIds = isAdmin
    ? []
    : await getManageStaffXUserIds(
        db,
        u.id,
        events.map((event) => event.id),
      );
  const warnActiveX = !isAdmin && shouldWarnManageActiveXMismatch(activeX, manageStaffXIds);
  const showXLinkRequests = await canManageXIdLinkRequests(db, {
    id: u.id,
    role: u.role ?? null,
  });

  return (
    <aside className="admin-sidebar">
      {consoleMode === "admin" ? <AdminModeBanner /> : <ManageModeBanner />}
      {isAdmin ? <AdminSidebarNav groups={buildAdminNavGroups()} /> : null}
      {canManage ? (
        <ManageSidebarNav
          events={events}
          showXLinkRequests={showXLinkRequests}
          warnActiveX={warnActiveX}
          activeX={activeX}
        />
      ) : null}
    </aside>
  );
}
