"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import navStyles from "@/components/admin/AdminSidebarNav.module.css";

export type ManageSidebarEvent = {
  id: string;
  title: string;
  accent_color: string | null;
};

export interface ManageSidebarNavProps {
  events: ManageSidebarEvent[];
  showXLinkRequests: boolean;
  warnActiveX: boolean;
  activeX: string | null;
}

function isManageHrefActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/manage") return pathname === "/manage";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ManageSidebarNav({
  events,
  showXLinkRequests,
  warnActiveX,
  activeX,
}: ManageSidebarNavProps): React.ReactElement {
  const pathname = usePathname();

  const links: { href: string; label: string; accent?: string | null }[] = [
    { href: "/manage", label: "運営トップ" },
  ];
  if (showXLinkRequests) {
    links.push({ href: "/manage/x-link-requests", label: "X ID 連携申請" });
  }
  for (const ev of events) {
    links.push({
      href: `/manage/events/${ev.id}`,
      label: ev.title,
      accent: ev.accent_color,
    });
  }

  return (
    <section className={navStyles.navGroup} aria-label="イベント運営ナビ">
      <h2 className={navStyles.navGroupTitle}>イベント運営</h2>
      {warnActiveX ? (
        <p className="console-sidebar-warn">
          運営権限は承認済み X ID 全体で判定されます。投稿主体は Active X ID
          {activeX ? ` (@${activeX})` : "（未選択）"}
          です。
        </p>
      ) : null}
      {links.map((item) => {
        const active = isManageHrefActive(item.href, pathname);
        const isEvent = item.href.startsWith("/manage/events/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${navStyles.navLink} ${active ? navStyles.navLinkActive : ""}`}
            aria-current={active ? "page" : undefined}
            title={item.label}
            style={
              isEvent && item.accent
                ? ({ "--event-accent": item.accent } as React.CSSProperties)
                : undefined
            }
            data-event-link={isEvent ? "true" : undefined}
          >
            {item.href === "/manage" ? (
              <Icon name="grid" size={14} aria-hidden />
            ) : item.href === "/manage/x-link-requests" ? (
              <Icon name="user" size={14} aria-hidden />
            ) : (
              <span className="console-sidebar-event-dot" aria-hidden />
            )}
            <span className="console-sidebar-link-label">{item.label}</span>
          </Link>
        );
      })}
      {events.length === 0 ? (
        <p className="console-sidebar-empty">担当イベントが割り当てられると、ここに一覧が表示されます。</p>
      ) : null}
    </section>
  );
}
