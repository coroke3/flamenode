import * as React from "react";
import { AdminResourceTabs } from "../shared/AdminResourceTabs.js";
import { normalizeUsersTab, type UsersQuery } from "../../api/adminUsers.js";

/** CURRENT AdminUserManagementTabs: preserve q/status when changing compatible tabs. */
export function AdminUserManagementTabs({ view, q = "", status = "" }: UsersQuery): React.ReactElement {
  const active = normalizeUsersTab(view);
  const href = (next: "discord" | "xid" | "permissions") => {
    const params = new URLSearchParams({ view: next });
    if (q && next !== "permissions") params.set("q", q);
    if (status && next === "discord") params.set("status", status);
    return "/admin/users?" + params.toString();
  };
  return <AdminResourceTabs
    active={active === "links" ? "link-requests" : active}
    ariaLabel="ユーザー管理メニュー"
    tabs={[
      { key: "discord", href: href("discord"), label: "Discordユーザー", icon: "discord" },
      { key: "xid", href: href("xid"), label: "X ID", icon: "x" },
      { key: "permissions", href: href("permissions"), label: "権限管理", icon: "settings" },
      { key: "link-requests", href: "/admin/x-link-requests", label: "X ID連携申請", icon: "user" },
      { key: "merges", href: "/admin/x-id-merges", label: "X ID統合申請", icon: "users" },
    ]}
  />;
}
