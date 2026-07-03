import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

export type ManageEventTabKey =
  | "overview"
  | "admin-detail"
  | "review"
  | "submissions"
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
};

type AdminLinkItem = {
  href: string;
  label: string;
  icon?: IconName;
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
      key: "review",
      href: `/manage/events/${encodedId}/videos?status=pending`,
      label: "審査",
      icon: "check",
    },
    {
      key: "slots",
      href: `/manage/events/${encodedId}/slots`,
      label: "枠管理",
      icon: "calendar",
    },
    {
      key: "submissions",
      href: `/manage/events/${encodedId}/videos?status=all`,
      label: "提出状況",
      icon: "list",
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
      label: "イベント設定",
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
      label: "通知",
      icon: "alert",
    },
    {
      key: "public",
      href: `/event/${encodedId}`,
      label: "公開ページ",
      icon: "external",
    },
  ];

  return (
    <>
      <nav className="fn-console-event-tabs" aria-label="イベント運営メニュー">
        {tabs.map((tab) => {
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
      {isAdmin ? <ManageAdminLinksMenu eventId={eventId} /> : null}
    </>
  );
}

export function ManageAdminLinksMenu({
  eventId,
}: {
  eventId: string;
}): React.ReactElement {
  const encodedId = encodeURIComponent(eventId);
  const links: AdminLinkItem[] = [
    {
      href: `/admin/events/${encodedId}`,
      label: "管理詳細",
      icon: "info",
    },
    {
      href: `/admin/videos?event=${encodedId}&status=pending`,
      label: "管理者用審査一覧",
      icon: "check",
    },
    {
      href: `/admin/audit?table=events&record=${encodedId}`,
      label: "監査ログ",
      icon: "clock",
    },
    {
      href: `/admin/notifications?event=${encodedId}`,
      label: "管理者用通知ログ",
      icon: "alert",
    },
    {
      href: `/admin/videos?event=${encodedId}`,
      label: "全作品管理で見る",
      icon: "youtube",
    },
  ];

  return (
    <div
      className="fn-console-badge-row"
      aria-label="サイト管理で開く"
      style={{ marginTop: 8 }}
    >
      <span className="fn-badge fn-badge-neutral">サイト管理で開く</span>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          {link.icon ? <Icon name={link.icon} size={11} aria-hidden /> : null}
          {link.label}
        </Link>
      ))}
    </div>
  );
}
