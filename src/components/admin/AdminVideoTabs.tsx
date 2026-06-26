import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

export type AdminVideoTabKey =
  | "detail"
  | "members"
  | "edit"
  | "permissions"
  | "public"
  | "audit";

interface AdminVideoTabsProps {
  videoId: string;
  youtubeVideoId?: string | null;
  active?: AdminVideoTabKey;
}

type TabItem = {
  key: AdminVideoTabKey;
  href: string;
  label: string;
  icon: IconName;
};

export function AdminVideoTabs({
  videoId,
  youtubeVideoId,
  active,
}: AdminVideoTabsProps): React.ReactElement {
  const encodedId = encodeURIComponent(videoId);
  const publicId = encodeURIComponent(youtubeVideoId || videoId);
  const tabs: TabItem[] = [
    {
      key: "detail",
      href: `/admin/videos/${encodedId}`,
      label: "管理詳細",
      icon: "info",
    },
    {
      key: "members",
      href: `/admin/videos/${encodedId}/members`,
      label: "メンバー",
      icon: "users",
    },
    {
      key: "edit",
      href: `/dashboard/edit/${encodedId}?privileged=admin`,
      label: "内容編集",
      icon: "edit",
    },
    {
      key: "permissions",
      href: `/dashboard/edit/${encodedId}/permissions?privileged=admin`,
      label: "編集権限",
      icon: "settings",
    },
    {
      key: "public",
      href: `/${publicId}`,
      label: "公開ページ",
      icon: "external",
    },
    {
      key: "audit",
      href: `/admin/audit?table=videos&record=${encodedId}`,
      label: "監査ログ",
      icon: "clock",
    },
  ];

  return (
    <nav className="fn-console-resource-tabs" aria-label="作品管理メニュー">
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
