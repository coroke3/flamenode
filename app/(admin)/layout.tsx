import * as React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthHeader } from "@/components/layout/AuthHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { Icon } from "@/components/ui/Icon";
import { buildHeaderUser, type HeaderUser } from "@/lib/auth/headerUser";
import styles from "./AdminLayout.module.css";

const ADMIN_NAV: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/admin", label: "総合ダッシュボード", icon: <Icon name="grid" size={14} /> },
  { href: "/admin/users", label: "ユーザー", icon: <Icon name="users" size={14} /> },
  { href: "/admin/users?view=xid", label: "X ID 一覧", icon: <Icon name="x" size={14} /> },
  { href: "/admin/users?view=permissions", label: "一般権限", icon: <Icon name="settings" size={14} /> },
  { href: "/admin/x-link-requests", label: "X 連携申請", icon: <Icon name="user" size={14} /> },
  { href: "/admin/videos", label: "作品", icon: <Icon name="youtube" size={14} /> },
  { href: "/admin/events", label: "イベント", icon: <Icon name="calendar" size={14} /> },
  { href: "/admin/announcements", label: "お知らせ", icon: <Icon name="alert" size={14} /> },
  { href: "/admin/rules", label: "規約", icon: <Icon name="info" size={14} /> },
  { href: "/admin/history", label: "履歴", icon: <Icon name="clock" size={14} /> },
  { href: "/admin/audit", label: "監査ログ", icon: <Icon name="clock" size={14} /> },
  { href: "/admin/notifications", label: "通知配信", icon: <Icon name="alert" size={14} /> },
  { href: "/admin/cost-guard", label: "コストガード", icon: <Icon name="warning" size={14} /> },
  { href: "/admin/health", label: "ヘルスチェック", icon: <Icon name="check" size={14} /> },
  { href: "/admin/security", label: "セキュリティ", icon: <Icon name="settings" size={14} /> },
  { href: "/admin/import", label: "インポート", icon: <Icon name="upload" size={14} /> },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  type AdminUser = {
    id: string;
    name: string;
    image: string | null;
    role: string;
    xIds: HeaderUser["xIds"];
  };
  let user: AdminUser | null = null;

  try {
    const session = await auth();
    if (session?.user) {
      const u = session.user as { id?: string; role?: string };
      const headerUser = await buildHeaderUser(session.user);
      if (headerUser) {
        user = {
          ...headerUser,
          id: u.id ?? headerUser.id,
          role: u.role ?? "user",
        };
      }
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
            <nav className={styles.nav}>
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.navLink}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className={styles.main}>{children}</main>
        </div>
      </div>
      <PublicFooter />
    </>
  );
}
