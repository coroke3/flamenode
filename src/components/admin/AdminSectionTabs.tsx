"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./AdminSectionTabs.module.css";

export type AdminSectionHub = "audit" | "health" | "events";

type TabItem = {
  href: string;
  label: string;
  icon: IconName;
};

const HUB_TABS: Record<AdminSectionHub, TabItem[]> = {
  audit: [
    { href: "/admin/audit", label: "監査ログ", icon: "clock" },
    { href: "/admin/audit/settings", label: "ログ設定", icon: "settings" },
    { href: "/admin/audit/restore", label: "復元履歴", icon: "refresh" },
  ],
  health: [
    { href: "/admin/health", label: "ヘルスチェック", icon: "check" },
    { href: "/admin/health/integrity", label: "DB整合性", icon: "list" },
    { href: "/admin/workers", label: "Worker監視", icon: "clock" },
  ],
  events: [
    { href: "/admin/events", label: "イベント一覧", icon: "calendar" },
    { href: "/admin/event-groups", label: "グループ", icon: "users" },
    { href: "/admin/events/templates", label: "テンプレート", icon: "copy" },
  ],
};

const HUB_ARIA_LABELS: Record<AdminSectionHub, string> = {
  audit: "監査メニュー",
  health: "診断メニュー",
  events: "イベント管理メニュー",
};

interface AdminSectionTabsProps {
  hub: AdminSectionHub;
}

export function AdminSectionTabs({ hub }: AdminSectionTabsProps): React.ReactElement {
  const pathname = usePathname();
  const tabs = HUB_TABS[hub];

  return (
    <nav className={styles.tabs} aria-label={HUB_ARIA_LABELS[hub]}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`fn-btn fn-btn-sm ${isActive ? "fn-btn-primary" : "fn-btn-ghost"}`}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon name={tab.icon} size={11} aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
