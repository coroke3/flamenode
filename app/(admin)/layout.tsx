import * as React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthHeader } from "@/components/layout/AuthHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { Icon } from "@/components/ui/Icon";

const ADMIN_NAV: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/admin", label: "総合ダッシュボード", icon: <Icon name="grid" size={14} /> },
  { href: "/admin/users", label: "ユーザー", icon: <Icon name="users" size={14} /> },
  { href: "/admin/x-link-requests", label: "X 連携申請", icon: <Icon name="user" size={14} /> },
  { href: "/admin/videos", label: "作品", icon: <Icon name="youtube" size={14} /> },
  { href: "/admin/events", label: "イベント", icon: <Icon name="calendar" size={14} /> },
  { href: "/admin/announcements", label: "お知らせ", icon: <Icon name="alert" size={14} /> },
  { href: "/admin/rules", label: "規約", icon: <Icon name="info" size={14} /> },
  { href: "/admin/history", label: "履歴", icon: <Icon name="clock" size={14} /> },
  { href: "/admin/cost-guard", label: "コストガード", icon: <Icon name="warning" size={14} /> },
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
    xIds: never[];
  };
  let user: AdminUser | null = null;

  try {
    const session = await auth();
    if (session?.user) {
      const u = session.user as { id?: string; role?: string };
      user = {
        id: u.id ?? "",
        name: session.user.name ?? "ゲスト",
        image: session.user.image ?? null,
        role: u.role ?? "user",
        xIds: [],
      };
    }
  } catch {
    user = null;
  }

  if (!user) redirect("/entry");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <>
      <AuthHeader user={user} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          minHeight: "calc(100vh - 56px - 80px)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "220px minmax(0, 1fr)",
            gap: 0,
            width: "min(100%, 1400px)",
            margin: "0 auto",
          }}
        >
          <aside
            style={{
              borderRight: "1px solid var(--border-subtle)",
              padding: "20px 16px",
              backgroundColor: "var(--bg-surface)",
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: 12,
              }}
            >
              ADMIN
            </p>
            <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    transition: "background-color 0.15s ease, color 0.15s ease",
                  }}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main style={{ padding: "20px 24px 40px", minWidth: 0 }}>
            {children}
          </main>
        </div>
      </div>
      <PublicFooter />
    </>
  );
}
