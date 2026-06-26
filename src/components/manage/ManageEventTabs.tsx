import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

export type ManageEventTabKey =
  | "overview"
  | "admin-detail"
  | "review"
  | "admin-review"
  | "slots"
  | "staff"
  | "edit"
  | "audience"
  | "notifications"
  | "public"
  | "audit"
  | "admin-notifications";

interface ManageEventTabsProps {
  eventId: string;
  active?: ManageEventTabKey;
  isAdmin?: boolean;
}

type TabItem = {
  key: ManageEventTabKey;
  href: string;
  label: string;
  icon?: IconName;
  adminOnly?: boolean;
};

export function ManageEventTabs({
  eventId,
  active,
  isAdmin = false,
}: ManageEventTabsProps): React.ReactElement {
  const encodedId = encodeURIComponent(eventId);
  const tabs: TabItem[] = [
    {
      key: "overview",
      href: `/manage/events/${encodedId}`,
      label: "運営トップ",
      icon: "grid",
    },
    {
      key: "admin-detail",
      href: `/admin/events/${encodedId}`,
      label: "管理詳細",
      icon: "info",
      adminOnly: true,
    },
    {
      key: "review",
      href: `/manage/events/${encodedId}/videos?status=pending`,
      label: "審査",
      icon: "check",
    },
    {
      key: "admin-review",
      href: `/admin/videos?event=${encodedId}&status=pending`,
      label: "管理者用審査一覧",
      adminOnly: true,
    },
    {
      key: "slots",
      href: `/manage/events/${encodedId}/slots`,
      label: "枠管理",
      icon: "calendar",
    },
    {
      key: "staff",
      href: `/manage/events/${encodedId}/staff`,
      label: "運営メンバー",
      icon: "users",
    },
    {
      key: "edit",
      href: `/manage/events/${encodedId}/edit`,
      label: "設定編集",
      icon: "settings",
    },
    {
      key: "audience",
      href: `/manage/events/${encodedId}/audience`,
      label: "登録者プレビュー",
      icon: "user",
    },
    {
      key: "notifications",
      href: `/manage/notifications?event=${encodedId}`,
      label: "通知センター",
      icon: "alert",
    },
    {
      key: "public",
      href: `/event/${encodedId}`,
      label: "公開ページを見る",
      icon: "external",
    },
    {
      key: "audit",
      href: `/admin/audit?table=events&record=${encodedId}`,
      label: "監査ログ",
      icon: "clock",
      adminOnly: true,
    },
    {
      key: "admin-notifications",
      href: `/admin/notifications?event=${encodedId}`,
      label: "管理者用通知ログ",
      icon: "alert",
      adminOnly: true,
    },
  ];

  return (
    <nav className="fn-console-event-tabs" aria-label="イベント運営メニュー">
      {tabs
        .filter((tab) => !tab.adminOnly || isAdmin)
        .map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={`fn-btn fn-btn-sm ${isActive ? "fn-btn-primary" : "fn-btn-ghost"}`}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.icon ? <Icon name={tab.icon} size={11} aria-hidden /> : null}
              {tab.label}
            </Link>
          );
        })}
    </nav>
  );
}
