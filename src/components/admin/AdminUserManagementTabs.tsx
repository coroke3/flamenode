import { AdminResourceTabs } from "@/components/admin/AdminResourceTabs";

export type AdminUserManagementTabKey =
  | "discord"
  | "xid"
  | "permissions"
  | "link-requests"
  | "merges";

function buildUsersHref({
  view,
  q,
  status,
}: {
  view: "discord" | "xid" | "permissions";
  q?: string;
  status?: string;
}): string {
  const params = new URLSearchParams({ view });
  if (q && view !== "permissions") params.set("q", q);
  if (status && view === "discord") params.set("status", status);
  return `/admin/users?${params}`;
}

export function AdminUserManagementTabs({
  active = "discord",
  q = "",
  status = "",
}: {
  active?: AdminUserManagementTabKey;
  q?: string;
  status?: string;
}) {
  return (
    <AdminResourceTabs
      active={active}
      ariaLabel="ユーザー管理メニュー"
      tabs={[
        { key: "discord", href: buildUsersHref({ view: "discord", q, status }), label: "Discordユーザー", icon: "discord" },
        { key: "xid", href: buildUsersHref({ view: "xid", q }), label: "X ID", icon: "x" },
        { key: "permissions", href: buildUsersHref({ view: "permissions" }), label: "権限管理", icon: "settings" },
        { key: "link-requests", href: "/admin/x-link-requests", label: "X ID連携申請", icon: "user" },
        { key: "merges", href: "/admin/x-id-merges", label: "X ID統合申請", icon: "users" },
      ]}
    />
  );
}
