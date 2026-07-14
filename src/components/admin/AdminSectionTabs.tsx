"use client";

import { usePathname } from "next/navigation";
import { AdminResourceTabs } from "@/components/admin/AdminResourceTabs";
import type { IconName } from "@/components/ui/Icon";
import styles from "./AdminSectionTabs.module.css";

export type AdminSectionHub = "audit" | "health" | "events";

type TabItem = {
  key: string;
  href: string;
  label: string;
  icon: IconName;
};

const HUB_TABS: Record<AdminSectionHub, readonly TabItem[]> = {
  audit: [
    { key: "/admin/audit", href: "/admin/audit", label: "監査ログ", icon: "clock" },
    { key: "/admin/audit/settings", href: "/admin/audit/settings", label: "ログ設定", icon: "settings" },
    { key: "/admin/audit/restore", href: "/admin/audit/restore", label: "復元履歴", icon: "refresh" },
  ],
  health: [
    { key: "/admin/health", href: "/admin/health", label: "ヘルスチェック", icon: "check" },
    { key: "/admin/health/integrity", href: "/admin/health/integrity", label: "DB整合性", icon: "list" },
    { key: "/admin/workers", href: "/admin/workers", label: "Worker監視", icon: "clock" },
  ],
  events: [
    { key: "/admin/events", href: "/admin/events", label: "イベント一覧", icon: "calendar" },
    { key: "/admin/event-groups", href: "/admin/event-groups", label: "グループ", icon: "users" },
    { key: "/admin/events/templates", href: "/admin/events/templates", label: "テンプレート", icon: "copy" },
  ],
};

const HUB_ARIA_LABELS: Record<AdminSectionHub, string> = {
  audit: "監査メニュー",
  health: "診断メニュー",
  events: "イベント管理メニュー",
};

export function AdminSectionTabs({ hub }: { hub: AdminSectionHub }) {
  return (
    <AdminResourceTabs
      tabs={HUB_TABS[hub]}
      active={usePathname()}
      ariaLabel={HUB_ARIA_LABELS[hub]}
      className={styles.tabs}
    />
  );
}
