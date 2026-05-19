import * as React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthHeader } from "@/components/layout/AuthHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { Icon } from "@/components/ui/Icon";
import { buildHeaderUser, type HeaderUser } from "@/lib/auth/headerUser";
import styles from "./AdminLayout.module.css";

const ADMIN_NAV_GROUPS: {
  title: string;
  items: { href: string; label: string; icon: React.ReactNode }[];
}[] = [
  {
    title: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: <Icon name="grid" size={14} /> }],
  },
  {
    title: "Today",
    items: [
      { href: "/admin/videos?status=pending", label: "Pending videos", icon: <Icon name="youtube" size={14} /> },
      { href: "/admin/x-link-requests", label: "X ID requests", icon: <Icon name="user" size={14} /> },
      { href: "/admin/notifications?status=failed", label: "Failed notices", icon: <Icon name="alert" size={14} /> },
    ],
  },
  {
    title: "Content",
    items: [
      { href: "/admin/videos", label: "Videos", icon: <Icon name="youtube" size={14} /> },
      { href: "/admin/events", label: "Events", icon: <Icon name="calendar" size={14} /> },
      { href: "/admin/announcements", label: "Announcements", icon: <Icon name="alert" size={14} /> },
    ],
  },
  {
    title: "Users",
    items: [
      { href: "/admin/users", label: "Users / X ID", icon: <Icon name="users" size={14} /> },
      { href: "/admin/users?view=permissions", label: "Permissions", icon: <Icon name="settings" size={14} /> },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/admin/rules", label: "Terms", icon: <Icon name="info" size={14} /> },
      { href: "/admin/audit", label: "Audit log", icon: <Icon name="clock" size={14} /> },
      { href: "/admin/cost-guard", label: "Cost guard", icon: <Icon name="warning" size={14} /> },
      { href: "/admin/health", label: "Health", icon: <Icon name="check" size={14} /> },
      { href: "/admin/security", label: "Security", icon: <Icon name="settings" size={14} /> },
      { href: "/admin/import", label: "Import", icon: <Icon name="upload" size={14} /> },
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
            <nav className={styles.nav}>
              {ADMIN_NAV_GROUPS.map((group) => (
                <section key={group.title} className={styles.navGroup}>
                  <h2 className={styles.navGroupTitle}>{group.title}</h2>
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={styles.navLink}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  ))}
                </section>
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
