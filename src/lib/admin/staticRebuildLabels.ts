import type { StaticRebuildTargetType } from "@/lib/staticRebuild/types";

const TARGET_LABELS: Record<StaticRebuildTargetType, string> = {
  top: "トップページ",
  events_index: "イベント一覧",
  event_groups_index: "イベントグループ一覧",
  event_group: "イベントグループ詳細",
  event: "イベント詳細",
  video: "作品詳細",
  user: "クリエイター",
  list_recent: "作品一覧（新着）",
  list_popular: "作品一覧（人気）",
  search_index: "検索インデックス",
};

const TARGET_ID_HINTS: Record<StaticRebuildTargetType, string> = {
  top: "global など固定ID",
  events_index: "global など固定ID",
  event_groups_index: "廃止（events_index を使用）",
  event_group: "廃止（events_index を使用）",
  event: "イベント ID",
  video: "作品 ID（内部）",
  user: "X ID",
  list_recent: "ページ番号など",
  list_popular: "ページ番号など",
  search_index: "global など固定ID",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待機中",
  processing: "処理中",
  done: "完了",
  failed: "失敗",
};

export function staticRebuildTargetLabel(type: string): string {
  return TARGET_LABELS[type as StaticRebuildTargetType] ?? type;
}

export function staticRebuildTargetIdHint(type: string): string {
  return TARGET_ID_HINTS[type as StaticRebuildTargetType] ?? "対象ID";
}

export function staticRebuildStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function staticRebuildAdminHref(
  targetType: string,
  targetId: string,
): string | null {
  switch (targetType) {
    case "event":
      return `/admin/events/${encodeURIComponent(targetId)}`;
    case "video":
      return `/admin/videos/${encodeURIComponent(targetId)}`;
    case "user":
      return `/admin/users?q=${encodeURIComponent(targetId)}`;
    case "events_index":
      return "/admin/events";
    case "event_groups_index":
      return "/admin/event-groups";
    case "event_group":
      return `/admin/event-groups?q=${encodeURIComponent(targetId)}`;
    case "list_recent":
    case "list_popular":
      return "/admin/videos";
    case "top":
      return "/";
    default:
      return null;
  }
}
