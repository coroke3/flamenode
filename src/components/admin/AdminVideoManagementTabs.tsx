import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  VIDEO_VISIBILITY_GROUPS,
  type VideoVisibilityGroupKey,
  videoVisibilityGroupForFilter,
} from "@/lib/admin/videoVisibilityLabels";

export type AdminVideoManagementTabKey =
  | "all"
  | VideoVisibilityGroupKey
  | "youtube-sync"
  | "youtube-playlists";

interface AdminVideoManagementTabsProps {
  q?: string;
  status?: string;
  event?: string;
  active?: AdminVideoManagementTabKey;
}

type StatusTab = {
  key: Exclude<
    AdminVideoManagementTabKey,
    "youtube-sync" | "youtube-playlists"
  >;
  value: string | null;
  label: string;
  icon: IconName;
};

type ExtraTab = {
  key: Extract<
    AdminVideoManagementTabKey,
    "youtube-sync" | "youtube-playlists"
  >;
  href: string;
  label: string;
  icon: IconName;
};

const GROUP_ICONS: Record<VideoVisibilityGroupKey, IconName> = {
  review: "check",
  public: "external",
  private: "pause",
  closed: "warning",
};

const STATUS_TABS: StatusTab[] = [
  { key: "all", value: null, label: "すべて", icon: "list" },
  ...VIDEO_VISIBILITY_GROUPS.map((group) => ({
    key: group.key,
    value: group.key,
    label: group.label,
    icon: GROUP_ICONS[group.key],
  })),
];

const EXTRA_TABS: ExtraTab[] = [
  {
    key: "youtube-sync",
    href: "/admin/youtube-sync",
    label: "メタデータ同期",
    icon: "refresh",
  },
  {
    key: "youtube-playlists",
    href: "/admin/youtube-sync/playlists",
    label: "再生リスト同期",
    icon: "list",
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
    status ? (videoVisibilityGroupForFilter(status) ?? "all") : "all";
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
