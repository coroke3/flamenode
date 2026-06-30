import * as React from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { PublicHeader, type PublicHeaderUser } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { Icon } from "@/components/ui/Icon";
import { buildHeaderUser } from "@/lib/auth/headerUser";
import {
  AdminSidebarNav,
  type AdminSidebarGroup,
} from "@/components/admin/AdminSidebarNav";
import { isAdminSpreadsheetEnabled } from "@/lib/admin/spreadsheet/guard";
import { AdminModeBanner } from "@/components/admin/AdminModeBanner";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const ADMIN_NAV_SPREADSHEET_ITEM = {
  href: "/admin/spreadsheet",
  label: "DBスプレッドシート",
  icon: <Icon name="grid" size={14} />,
} as const;

const ADMIN_NAV_GROUPS_BASE: AdminSidebarGroup[] = [
  {
    title: "概要",
    items: [
      { href: "/admin", label: "ダッシュボード", icon: <Icon name="grid" size={14} /> },
    ],
  },
  {
    title: "対応待ち",
    items: [
      { href: "/admin/videos?status=pending", label: "承認待ち作品", icon: <Icon name="youtube" size={14} /> },
      { href: "/admin/x-link-requests", label: "X ID連携申請", icon: <Icon name="user" size={14} /> },
      { href: "/admin/x-id-merges", label: "X ID統合申請", icon: <Icon name="users" size={14} /> },
      { href: "/admin/moderation?status=open", label: "モデレーション", icon: <Icon name="warning" size={14} /> },
      { href: "/admin/notifications?status=failed", label: "通知失敗", icon: <Icon name="alert" size={14} /> },
    ],
  },
  {
    title: "コンテンツ",
    items: [
      { href: "/admin/videos", label: "作品管理", icon: <Icon name="youtube" size={14} /> },
      { href: "/admin/youtube-sync", label: "YouTube同期状態", icon: <Icon name="refresh" size={14} /> },
      { href: "/admin/events", label: "イベント管理", icon: <Icon name="calendar" size={14} /> },
      { href: "/admin/event-groups", label: "イベントグループ", icon: <Icon name="users" size={14} /> },
      { href: "/admin/events/templates", label: "イベントテンプレート", icon: <Icon name="copy" size={14} /> },
      { href: "/admin/api-endpoints", label: "公開API管理", icon: <Icon name="external" size={14} /> },
      { href: "/admin/announcements", label: "お知らせ管理", icon: <Icon name="alert" size={14} /> },
    ],
  },
  {
    title: "ユーザー",
    items: [
      { href: "/admin/users", label: "ユーザー / X ID", icon: <Icon name="users" size={14} /> },
      { href: "/admin/users?view=permissions", label: "権限管理", icon: <Icon name="settings" size={14} /> },
    ],
  },
  {
    title: "システム",
    items: [
      { href: "/admin/rules", label: "規約管理", icon: <Icon name="info" size={14} /> },
      { href: "/admin/audit", label: "監査ログ", icon: <Icon name="clock" size={14} /> },
      { href: "/admin/cost-guard", label: "コストガード", icon: <Icon name="warning" size={14} /> },
      { href: "/admin/static-builds", label: "静的JSON再生成", icon: <Icon name="refresh" size={14} /> },
      { href: "/admin/health", label: "ヘルスチェック", icon: <Icon name="check" size={14} /> },
      { href: "/admin/health/integrity", label: "DB整合性チェック", icon: <Icon name="list" size={14} /> },
      { href: "/admin/security", label: "セキュリティ", icon: <Icon name="settings" size={14} /> },
      { href: "/admin/import", label: "インポート", icon: <Icon name="upload" size={14} /> },
    ],
  },
];

function buildAdminNavGroups(): AdminSidebarGroup[] {
  if (!isAdminSpreadsheetEnabled()) {
    return ADMIN_NAV_GROUPS_BASE;
  }
  return ADMIN_NAV_GROUPS_BASE.map((group) =>
    group.title === "システム"
      ? {
          ...group,
          items: [...group.items, ADMIN_NAV_SPREADSHEET_ITEM],
        }
      : group,
  );
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let user: PublicHeaderUser | null = null;

  try {
    const session = await auth();
    if (session?.user) {
      const headerUser = await buildHeaderUser(session.user);
      if (headerUser) user = headerUser;
    }
  } catch {
    user = null;
  }

  if (!user) redirect("/entry");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <div data-admin-shell data-fn-surface="public">
      <PublicHeader user={user} />
      <div className="admin-shell">
        <div className="admin-frame">
          <aside className="admin-sidebar">
            <AdminModeBanner />
            <AdminSidebarNav groups={buildAdminNavGroups()} />
          </aside>
          <main className="admin-main">{children}</main>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
