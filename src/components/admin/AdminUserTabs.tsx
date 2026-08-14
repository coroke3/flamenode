import { AdminResourceTabs } from "@/components/admin/AdminResourceTabs";

export type AdminUserTabKey = "detail" | "edit" | "audit";

export function AdminUserTabs({
  userId,
  active,
}: {
  userId: string;
  active?: AdminUserTabKey;
}) {
  const id = encodeURIComponent(userId);
  return (
    <AdminResourceTabs
      active={active}
      ariaLabel="ユーザー管理メニュー"
      tabs={[
        { key: "detail", href: `/admin/users/${id}`, label: "ユーザー詳細", icon: "user" },
        { key: "edit", href: `/admin/users/${id}/edit`, label: "設定編集", icon: "edit" },
        {
          key: "audit",
          href: `/admin/audit?actor=${id}`,
          label: "操作履歴",
          icon: "clock",
        },
      ]}
    />
  );
}
