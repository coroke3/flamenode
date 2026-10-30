// Port of CURRENT src/components/admin/AdminUserManagementTabs.tsx for MIG-0732 (shared with MIG-0731).
import { AdminResourceTabs } from "../shared/AdminResourceTabs.js";

export type AdminUserManagementTabKey = "discord" | "xid" | "permissions" | "link-requests" | "merges";

function usersHref(view: "discord" | "xid" | "permissions", q: string, status: string): string {
  const params = new URLSearchParams({ view });
  if (q && view !== "permissions") params.set("q", q);
  if (status && view === "discord") params.set("status", status);
  return "/admin/users?" + params.toString();
}

export function AdminUserManagementTabs({ active = "discord", q = "", status = "" }: {
  active?: AdminUserManagementTabKey;
  q?: string;
  status?: string;
}) {
  return <AdminResourceTabs active={active} ariaLabel="ユーザー管理メニュー" tabs={[
    { key: "discord", href: usersHref("discord", q, status), label: "Discordユーザー", icon: "discord" },
    { key: "xid", href: usersHref("xid", q, status), label: "X ID", icon: "x" },
    { key: "permissions", href: usersHref("permissions", q, status), label: "権限管理", icon: "settings" },
    { key: "link-requests", href: "/admin/x-link-requests", label: "X ID連携申請", icon: "user" },
    { key: "merges", href: "/admin/x-id-merges", label: "X ID統合申請", icon: "users" },
  ]} />;
}
