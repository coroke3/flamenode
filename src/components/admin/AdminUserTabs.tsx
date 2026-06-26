import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

export type AdminUserTabKey = "detail" | "edit" | "audit";

interface AdminUserTabsProps {
  userId: string;
  active?: AdminUserTabKey;
}

type TabItem = {
  key: AdminUserTabKey;
  href: string;
  label: string;
  icon: IconName;
};

export function AdminUserTabs({
  userId,
  active,
}: AdminUserTabsProps): React.ReactElement {
  const encodedId = encodeURIComponent(userId);
  const tabs: TabItem[] = [
    {
      key: "detail",
      href: `/admin/users/${encodedId}`,
      label: "ユーザー詳細",
      icon: "user",
    },
    {
      key: "edit",
      href: `/admin/users/${encodedId}/edit`,
      label: "設定編集",
      icon: "edit",
    },
    {
      key: "audit",
      href: `/admin/audit?operator=${encodedId}`,
      label: "操作履歴",
      icon: "clock",
    },
  ];

  return (
    <nav className="fn-console-resource-tabs" aria-label="ユーザー管理メニュー">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
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
