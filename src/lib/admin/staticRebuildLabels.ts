import type { StaticRebuildTargetType } from "@/lib/staticRebuild/types";

const TARGET_LABELS: Record<StaticRebuildTargetType, string> = {
  top: "トップページ（composer）",
  top_recommended: "トップ注目棚",
  top_latest: "トップ新着棚",
  top_nostalgic: "トップ懐かし棚",
  top_events: "トップイベント棚",
  top_announcements: "トップお知らせ棚",
  top_stats: "トップ統計",
  top_slot_stats: "トップ hero slot_stats",
  events_index: "イベント一覧",
  event_base: "イベント詳細（base）",
  event_slots: "イベント詳細（slots）",
  event: "イベント詳細（composer）",
  video: "作品詳細",
  user: "クリエイター",
  users_index: "クリエイター一覧",
  list_recent: "作品一覧（新着）",
  list_popular: "作品一覧（人気）",
  search_index: "検索インデックス",
  recommend_core: "おすすめコア（動画プール）",
  recommend: "おすすめページ",
  rules: "利用規約",
  youtube_related_blocklist: "YouTube関連blocklist",
  random_video_pool: "関連ランダムプール",
  member_suggestions: "合作メンバーX ID候補インデックス",
};

const TARGET_ID_HINTS: Record<StaticRebuildTargetType, string> = {
  top: "global など固定ID",
  top_recommended: "global など固定ID",
  top_latest: "global など固定ID",
  top_nostalgic: "global など固定ID",
  top_events: "global など固定ID",
  top_announcements: "global など固定ID",
  top_stats: "global など固定ID",
  top_slot_stats: "global など固定ID",
  events_index: "global など固定ID",
  event_base: "イベント ID",
  event_slots: "イベント ID",
  event: "イベント ID",
  video: "作品 ID（内部）",
  user: "X ID",
  users_index: "global など固定ID",
  list_recent: "ページ番号など",
  list_popular: "ページ番号など",
  search_index: "global など固定ID",
  recommend_core: "global など固定ID",
  recommend: "global など固定ID",
  rules: "global など固定ID",
  youtube_related_blocklist: "global など固定ID",
  random_video_pool: "global など固定ID",
  member_suggestions: "global など固定ID",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待機中",
  processing: "処理中",
  done: "完了",
  failed: "失敗",
  dead_letter: "最終失敗",
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
    case "event_base":
    case "event_slots":
      return `/manage/events/${encodeURIComponent(targetId)}`;
    case "video":
      return `/admin/videos/${encodeURIComponent(targetId)}`;
    case "user":
      return `/admin/users?q=${encodeURIComponent(targetId)}`;
    case "events_index":
      return "/admin/events";
    case "users_index":
      return "/user";
    case "recommend":
    case "recommend_core":
      return "/recommend";
    case "list_recent":
    case "list_popular":
      return "/admin/videos";
    case "top":
    case "top_recommended":
    case "top_latest":
    case "top_nostalgic":
    case "top_events":
    case "top_announcements":
    case "top_stats":
    case "top_slot_stats":
      return "/";
    case "rules":
      return "/rules";
    default:
      return null;
  }
}
