import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

export type AdminUserManagementTabKey =
  | "discord"
  | "xid"
  | "permissions"
  | "link-requests"
  | "merges";

interface AdminUserManagementTabsProps {
  active?: AdminUserManagementTabKey;
  q?: string;
  status?: string;
}

type TabItem = {
  key: AdminUserManagementTabKey;
  href: string;
  label: string;
  icon: IconName;
};

function buildUsersHref({
  view,
  q,
  status,
}: {
  view: "discord" | "xid" | "permissions";
  q?: string;
  status?: string;
}): string {
  const params = new URLSearchParams();
  params.set("view", view);
  if (q && view !== "permissions") params.set("q", q);
  if (status && view === "discord") params.set("status", status);
  return `/admin/users?${params.toString()}`;
}

export function AdminUserManagementTabs({
  active = "discord",
  q = "",
  status = "",
}: AdminUserManagementTabsProps): React.ReactElement {
  const tabs: TabItem[] = [
    {
      key: "discord",
      href: buildUsersHref({ view: "discord", q, status }),
      label: "Discordユーザー",
      icon: "discord",
    },
    {
      key: "xid",
      href: buildUsersHref({ view: "xid", q }),
      label: "X ID",
      icon: "x",
    },
    {
      key: "permissions",
      href: buildUsersHref({ view: "permissions" }),
      label: "権限管理",
      icon: "settings",
    },
    {
      key: "link-requests",
      href: "/admin/x-link-requests",
      label: "X ID連携申請",
      icon: "user",
    },
    {
      key: "merges",
      href: "/admin/x-id-merges",
      label: "X ID統合申請",
      icon: "users",
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
