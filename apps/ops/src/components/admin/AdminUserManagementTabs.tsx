import * as React from "react";
import { AdminResourceTabs } from "../shared/AdminResourceTabs.js";

/** Shared MIG-0731 / MIG-0732 tab contract: accept both CURRENT view and active key. */
export type AdminUserManagementTabKey = "discord" | "xid" | "permissions" | "link-requests" | "merges";
type Props = { active?: AdminUserManagementTabKey; view?: string | null; q?: string; status?: string };
export function AdminUserManagementTabs({ active, view, q = "", status = "" }: Props): React.ReactElement {
  const normalized = view === "links" ? "link-requests"
    : view === "xid" || view === "permissions" ? view : "discord";
  const selected = active ?? normalized;
  const href = (next: "discord" | "xid" | "permissions") => {
    const params = new URLSearchParams({ view: next });
    if (q && next !== "permissions") params.set("q", q);
    if (status && next === "discord") params.set("status", status);
    return "/admin/users?" + params.toString();
  };
  return <AdminResourceTabs active={selected} ariaLabel="ユーザー管理メニュー" tabs={[
    { key: "discord", href: href("discord"), label: "Discordユーザー", icon: "discord" },
    { key: "xid", href: href("xid"), label: "X ID", icon: "x" },
    { key: "permissions", href: href("permissions"), label: "権限管理", icon: "settings" },
    { key: "link-requests", href: "/admin/x-link-requests", label: "X ID連携申請", icon: "user" },
    { key: "merges", href: "/admin/x-id-merges", label: "X ID統合申請", icon: "users" },
  ]} />;
}
