import * as React from "react";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  getManageAuthorizationSnapshot,
  getManageStaffXUserIdsFromSnapshot,
} from "@/lib/auth/manageAuthorization";
import { shouldWarnManageActiveXMismatch } from "@/lib/auth/ownership";
import { AdminSidebarNav } from "@/components/admin/AdminSidebarNav";
import { buildAdminNavGroups } from "@/lib/admin/adminNavGroups";
import { getManageNavigationSnapshot } from "@/lib/manage/navigationEvents";
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

  const authorization = await getManageAuthorizationSnapshot(
    u.id,
    u.role ?? null,
  );
  const navigation = await getManageNavigationSnapshot(u.id, u.role ?? null);
  if (
    !isAdmin &&
    navigation.events.length === 0 &&
    !authorization.canManageXIdLinkRequests
  ) {
    return null;
  }

  const activeX = u.active_x_user_id?.trim() || null;
  const manageStaffXIds = getManageStaffXUserIdsFromSnapshot(authorization);
  const warnActiveX = !isAdmin && shouldWarnManageActiveXMismatch(activeX, manageStaffXIds);
  return (
    <aside className="admin-sidebar">
      <SidebarModeBanner mode="manage" />
      <ManageSidebarNav
        events={navigation.events}
        showXLinkRequests={authorization.canManageXIdLinkRequests}
        warnActiveX={warnActiveX}
        activeX={activeX}
      />
    </aside>
  );
}
