import * as React from "react";
import {
  and,
  countDistinct,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  getEditableEventIds,
  getManageStaffXUserIds,
  canManageXIdLinkRequests,
  shouldWarnManageActiveXMismatch,
} from "@/lib/auth/ownership";
import {
  events as eventsTable,
  videoEvents,
  videos,
} from "@/lib/db/schema";
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
  if (consoleMode === "admin") {
    if (!isAdmin) return null;
    return (
      <aside className="admin-sidebar">
        <AdminModeBanner />
        <AdminSidebarNav groups={buildAdminNavGroups()} />
      </aside>
    );
  }

  const editableEventIds = isAdmin ? [] : await getEditableEventIds(db, u.id);
  const showXLinkRequests = await canManageXIdLinkRequests(db, {
    id: u.id,
    role: u.role ?? null,
  });
  if (!isAdmin && editableEventIds.length === 0 && !showXLinkRequests) {
    return null;
  }

  const eventSelect = {
    id: eventsTable.id,
    title: eventsTable.title,
    accent_color: eventsTable.accent_color,
    visibility_status:
      eventsTable.visibility_status,
    start_time: eventsTable.start_time,
    end_time: eventsTable.end_time,
    entry_start_time:
      eventsTable.entry_start_time,
    entry_end_time:
      eventsTable.entry_end_time,
    pending_review_count:
      countDistinct(videos.id),
  };

  const eventQuery = db
    .select(eventSelect)
    .from(eventsTable)
    .leftJoin(
      videoEvents,
      eq(
        videoEvents.event_id,
        eventsTable.id,
      ),
    )
    .leftJoin(
      videos,
      and(
        eq(
          videos.id,
          videoEvents.video_id,
        ),
        eq(
          videos.visibility_status,
          "pending",
        ),
      ),
    )
    .where(
      isAdmin
        ? undefined
        : inArray(
            eventsTable.id,
            editableEventIds,
          ),
    )
    .groupBy(
      eventsTable.id,
      eventsTable.title,
      eventsTable.accent_color,
      eventsTable.visibility_status,
      eventsTable.start_time,
      eventsTable.end_time,
      eventsTable.entry_start_time,
      eventsTable.entry_end_time,
    )
    .orderBy(
      desc(eventsTable.start_time),
      desc(eventsTable.created_at),
      desc(eventsTable.id),
    );

  const events =
    editableEventIds.length > 0 || isAdmin
      ? await eventQuery
      : [];

  const normalizedEvents = events.map(
    (event) => ({
      ...event,
      pending_review_count:
        Number(
          event.pending_review_count ?? 0,
        ),
    }),
  );

  const activeX = u.active_x_user_id?.trim() || null;
  const manageStaffXIds = isAdmin
    ? []
    : await getManageStaffXUserIds(
        db,
        u.id,
        normalizedEvents.map((event) => event.id),
      );
  const warnActiveX = !isAdmin && shouldWarnManageActiveXMismatch(activeX, manageStaffXIds);
  return (
    <aside className="admin-sidebar">
      <ManageModeBanner />
      <ManageSidebarNav
        events={normalizedEvents}
        showXLinkRequests={showXLinkRequests}
        warnActiveX={warnActiveX}
        activeX={activeX}
      />
    </aside>
  );
}
