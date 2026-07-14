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
import { buildAdminNavGroups } from "@/lib/admin/adminNavGroups";
import { ManageSidebarNav } from "./ManageSidebarNav";

function ConsoleModeBanner({
  classPrefix,
  badge,
  label,
  children,
}: {
  classPrefix: "admin-mode" | "manage-mode";
  badge: string;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={`${classPrefix}-banner`}>
      <span className={`${classPrefix}-badge`}>{badge}</span>
      <span className={`${classPrefix}-label`}>{label}</span>
      <p className={`${classPrefix}-hint`}>{children}</p>
    </div>
  );
}

function SidebarModeBanner({
  mode,
}: {
  mode: "admin" | "manage";
}): React.ReactElement {
  if (mode === "admin") {
    return (
      <ConsoleModeBanner
        classPrefix="admin-mode"
        badge="ADMIN"
        label="サイト管理"
      >
        サイト全体の設定・監査・ユーザー管理を行います。
        担当イベントの現場運用は
        <strong> /manage</strong>
        から行ってください。
      </ConsoleModeBanner>
    );
  }

  return (
    <ConsoleModeBanner
      classPrefix="manage-mode"
      badge="MANAGE"
      label="イベント運営"
    >
      担当イベントの審査・枠・通知を確認できます。
      サイト全体の管理は管理者のみ
      <strong> /admin</strong>
      で行います。
    </ConsoleModeBanner>
  );
}

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
        <SidebarModeBanner mode="admin" />
        <AdminSidebarNav groups={buildAdminNavGroups()} />
      </aside>
    );
  }

  const [editableEventIds, showXLinkRequests] = await Promise.all([
    isAdmin ? Promise.resolve([]) : getEditableEventIds(db, u.id),
    canManageXIdLinkRequests(db, {
      id: u.id,
      role: u.role ?? null,
    }),
  ]);
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
      <SidebarModeBanner mode="manage" />
      <ManageSidebarNav
        events={normalizedEvents}
        showXLinkRequests={showXLinkRequests}
        warnActiveX={warnActiveX}
        activeX={activeX}
      />
    </aside>
  );
}
