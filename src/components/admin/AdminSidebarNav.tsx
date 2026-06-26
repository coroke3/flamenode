"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import styles from "./AdminSidebarNav.module.css";

export interface AdminSidebarItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export interface AdminSidebarGroup {
  title: string;
  items: AdminSidebarItem[];
}

export interface AdminSidebarNavProps {
  groups: AdminSidebarGroup[];
}

/**
 * admin サイドバーの現在地ハイライト用 client component。
 *
 * 判定ルール:
 *   - href が exact パス一致 → active
 *   - href にクエリパラメータがある場合は path 一致 + 主要 query 一致 (status, view, notif 等) で active
 *   - href が `/admin/foo` のとき、現在パスが `/admin/foo/*` でもサブツリーとして active
 *     (ただし他のメニューと衝突する場合は exact 一致を優先する)
 */
export function AdminSidebarNav({
  groups,
}: AdminSidebarNavProps): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isActive = (href: string): boolean => {
    const [hrefPath, hrefQuery] = href.split("?");
    if (!pathname) return false;
    if (hrefQuery) {
      // クエリ付きメニューは path と主要 query が一致したときだけ active。
      if (pathname !== hrefPath) return false;
      const params = new URLSearchParams(hrefQuery);
      for (const [key, value] of params.entries()) {
        if (searchParams.get(key) !== value) return false;
      }
      return true;
    }
    const querySpecificActive = groups.some((group) =>
      group.items.some((item) => {
        const [itemPath, itemQuery] = item.href.split("?");
        if (!itemQuery || itemPath !== hrefPath || pathname !== itemPath) {
          return false;
        }
        const params = new URLSearchParams(itemQuery);
        for (const [key, value] of params.entries()) {
          if (searchParams.get(key) !== value) return false;
        }
        return true;
      }),
    );
    if (querySpecificActive) return false;

    // /admin はトップなので exact 一致のみ。
    if (hrefPath === "/admin") return pathname === "/admin";
    // それ以外はサブツリー一致 (例: /admin/videos と /admin/videos/[id])。
    // ただし同階層に query 付きメニュー (例: /admin/videos?status=pending) があるときは
    // そちらの判定で先に拾われるので問題ない。
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  };

  return (
    <nav className={styles.nav} aria-label="管理ナビゲーション">
      {groups.map((group) => (
        <section key={group.title} className={styles.navGroup}>
          <h2 className={styles.navGroupTitle}>{group.title}</h2>
          {group.items.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
