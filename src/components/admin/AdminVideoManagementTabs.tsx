import { AdminResourceTabs } from "@/components/admin/AdminResourceTabs";
import type { IconName } from "@/components/ui/Icon";
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

const GROUP_ICONS: Record<VideoVisibilityGroupKey, IconName> = {
  review: "check",
  public: "external",
  private: "pause",
  closed: "warning",
};

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
}: {
  q?: string;
  status?: string;
  event?: string;
  active?: AdminVideoManagementTabKey;
}) {
  const activeKey = active ?? (status ? videoVisibilityGroupForFilter(status) : null) ?? "all";
  const tabs = [
    { key: "all" as const, href: buildVideosHref({ q, event }), label: "すべて", icon: "list" as const },
    ...VIDEO_VISIBILITY_GROUPS.map((group) => ({
      key: group.key,
      href: buildVideosHref({ q, event, status: group.key }),
      label: group.label,
      icon: GROUP_ICONS[group.key],
    })),
    { key: "youtube-sync" as const, href: "/admin/youtube-sync", label: "メタデータ同期", icon: "refresh" as const },
    { key: "youtube-playlists" as const, href: "/admin/youtube-sync/playlists", label: "再生リスト同期", icon: "list" as const },
  ];
  return <AdminResourceTabs tabs={tabs} active={activeKey} ariaLabel="作品管理メニュー" />;
}
