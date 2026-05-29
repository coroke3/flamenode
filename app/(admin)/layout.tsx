import * as React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthHeader } from "@/components/layout/AuthHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { Icon } from "@/components/ui/Icon";
import { buildHeaderUser, type HeaderUser } from "@/lib/auth/headerUser";
import {
  AdminSidebarNav,
  type AdminSidebarGroup,
} from "@/components/admin/AdminSidebarNav";
import styles from "./AdminLayout.module.css";

const ADMIN_NAV_GROUPS: AdminSidebarGroup[] = [
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
      { href: "/admin/health", label: "ヘルスチェック", icon: <Icon name="check" size={14} /> },
      { href: "/admin/health/integrity", label: "DB整合性チェック", icon: <Icon name="list" size={14} /> },
      { href: "/admin/security", label: "セキュリティ", icon: <Icon name="settings" size={14} /> },
      { href: "/admin/import", label: "インポート", icon: <Icon name="upload" size={14} /> },
    ],
  },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let user: HeaderUser | null = null;

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
    <>
      <AuthHeader user={user} />
      <div className={styles.shell}>
        <div className={styles.frame}>
          <aside className={styles.sidebar}>
            <p className={styles.eyebrow}>ADMIN</p>
            <AdminSidebarNav groups={ADMIN_NAV_GROUPS} />
          </aside>
          <main className={styles.main}>{children}</main>
        </div>
      </div>
      <PublicFooter />
    </>
  );
}
