import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

export type AdminVideoManagementTabKey =
  | "all"
  | "pending"
  | "public"
  | "limited"
  | "private"
  | "hidden"
  | "draft"
  | "archived"
  | "voided"
  | "youtube-sync";

interface AdminVideoManagementTabsProps {
  q?: string;
  status?: string;
  event?: string;
  active?: AdminVideoManagementTabKey;
}

type StatusTab = {
  key: Exclude<AdminVideoManagementTabKey, "youtube-sync">;
  value: string | null;
  label: string;
  icon: IconName;
};

type ExtraTab = {
  key: Extract<AdminVideoManagementTabKey, "youtube-sync">;
  href: string;
  label: string;
  icon: IconName;
};

const STATUS_TABS: StatusTab[] = [
  { key: "all", value: null, label: "すべて", icon: "list" },
  { key: "pending", value: "pending", label: "審査待ち", icon: "check" },
  { key: "public", value: "public", label: "公開", icon: "external" },
  { key: "limited", value: "limited", label: "限定公開", icon: "user" },
  { key: "private", value: "private", label: "非公開", icon: "pause" },
  { key: "hidden", value: "hidden", label: "非表示", icon: "mute" },
  { key: "draft", value: "draft", label: "下書き", icon: "edit" },
  { key: "archived", value: "archived", label: "アーカイブ", icon: "grid" },
  { key: "voided", value: "voided", label: "無効", icon: "warning" },
];

const EXTRA_TABS: ExtraTab[] = [
  {
    key: "youtube-sync",
    href: "/admin/youtube-sync",
    label: "YouTube同期",
    icon: "refresh",
  },
];

function buildVideosHref({
  q,
  event,
  status,
}: {
  q?: string;
  event?: string;
  status?: string | null;
}): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (event) params.set("event", event);
  const query = params.toString();
  return query ? `/admin/videos?${query}` : "/admin/videos";
}

export function AdminVideoManagementTabs({
  q = "",
  status = "",
  event = "",
  active,
}: AdminVideoManagementTabsProps): React.ReactElement {
  const statusKey =
    STATUS_TABS.find((tab) => tab.value === (status || null))?.key ?? "all";
  const activeKey = active ?? statusKey;

  return (
    <nav className="fn-console-resource-tabs" aria-label="作品管理メニュー">
      {STATUS_TABS.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <Link
            key={tab.key}
            href={buildVideosHref({ q, event, status: tab.value })}
            className={`fn-btn fn-btn-sm ${isActive ? "fn-btn-primary" : "fn-btn-ghost"}`}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon name={tab.icon} size={11} aria-hidden />
            {tab.label}
          </Link>
        );
      })}
      {EXTRA_TABS.map((tab) => {
        const isActive = tab.key === activeKey;
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
