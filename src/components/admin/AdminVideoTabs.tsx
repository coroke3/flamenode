import { AdminResourceTabs } from "@/components/admin/AdminResourceTabs";

export type AdminVideoTabKey =
  | "detail"
  | "members"
  | "edit"
  | "permissions"
  | "public"
  | "audit";

export function AdminVideoTabs({
  videoId,
  youtubeVideoId,
  active,
}: {
  videoId: string;
  youtubeVideoId?: string | null;
  active?: AdminVideoTabKey;
}) {
  const id = encodeURIComponent(videoId);
  const publicId = encodeURIComponent(youtubeVideoId?.trim() || videoId);
  return (
    <AdminResourceTabs
      active={active}
      ariaLabel="作品管理メニュー"
      tabs={[
        { key: "detail", href: `/admin/videos/${id}`, label: "管理詳細", icon: "info" },
        { key: "members", href: `/admin/videos/${id}/members`, label: "メンバー", icon: "users" },
        { key: "edit", href: `/dashboard/edit/${id}?privileged=admin`, label: "内容編集", icon: "edit" },
        { key: "permissions", href: `/dashboard/edit/${id}/permissions?privileged=admin`, label: "編集権限", icon: "settings" },
        { key: "public", href: `/${publicId}`, label: "公開ページ", icon: "external" },
        { key: "audit", href: `/admin/audit?table=videos&record=${id}`, label: "監査ログ", icon: "clock" },
      ]}
    />
  );
}
