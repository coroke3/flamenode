/**
 * notification_outbox.type の分類・重要度・表示ラベル。
 * enqueue 側の type 文字列と UI フィルタの正本。
 */

export type NotificationCategory =
  | "video"
  | "slot"
  | "x_id"
  | "event"
  | "system"
  | "moderation"
  | "chapter"
  | "announcement"
  | "unknown";

export type NotificationSeverity = "critical" | "warning" | "info" | "silent";

/** /manage の通知フィルタ (UI 用。all は集計のみ) */
export type ManageNotificationFilter =
  | "all"
  | "video"
  | "slot"
  | "x_id"
  | "chapter"
  | "other";

const TYPE_LABELS: Record<string, string> = {
  video_submitted: "作品を受け付けました",
  video_approved: "作品が公開されました",
  video_voided: "作品について確認があります",
  video_pending: "作品が審査待ちになりました",
  video_draft: "作品が下書きになりました",
  video_limited: "作品の公開範囲が変更されました",
  video_private: "作品の公開範囲が変更されました",
  video_hidden: "作品の公開範囲が変更されました",
  video_archived: "作品のアーカイブ状態が変更されました",
  video_status_changed: "作品の状態が変更されました",
  video_edit_permission_granted: "編集権限が付与されました",
  slot_video_submitted: "枠投稿を受け付けました",
  slot_deadline_reminder: "投稿締切が近づいています",
  slot_force_released: "枠が解放されました",
  slot_voided: "枠が無効になりました",
  x_id_approved: "X ID が承認されました",
  x_id_rejected: "X ID が却下されました",
  x_id_alias_approved: "X ID エイリアスが承認されました",
  chapter_comment_added: "チャプターコメントが追加されました",
  moderation_created: "モデレーション案件が作成されました",
  announcement_broadcast: "お知らせ配信",
  terms_reaccept_required: "利用規約の再同意が必要です",
  discord_webhook: "Webhook 配信",
};

const SEVERITY_BY_TYPE: Record<string, NotificationSeverity> = {
  video_voided: "critical",
  slot_force_released: "warning",
  x_id_rejected: "warning",
  moderation_created: "warning",
  slot_deadline_reminder: "warning",
  video_approved: "info",
  video_submitted: "info",
  slot_video_submitted: "info",
  video_edit_permission_granted: "info",
  x_id_approved: "info",
  x_id_alias_approved: "info",
  chapter_comment_added: "info",
  announcement_broadcast: "info",
  terms_reaccept_required: "info",
  video_pending: "silent",
  video_draft: "silent",
};

function prefixCategory(type: string, prefix: string): boolean {
  return type.startsWith(prefix);
}

export function categorizeNotificationType(type: string): NotificationCategory {
  const t = type.trim();
  if (!t) return "unknown";
  if (prefixCategory(t, "video_")) return "video";
  if (prefixCategory(t, "slot_")) return "slot";
  if (prefixCategory(t, "x_id_")) return "x_id";
  if (prefixCategory(t, "chapter_")) return "chapter";
  if (prefixCategory(t, "moderation_")) return "moderation";
  if (prefixCategory(t, "announcement_")) return "announcement";
  if (prefixCategory(t, "event_")) return "event";
  if (t === "discord_webhook") return "system";
  return "unknown";
}

export function getNotificationSeverity(type: string): NotificationSeverity {
  return SEVERITY_BY_TYPE[type] ?? "info";
}

export function getNotificationTypeLabel(type: string): string {
  const key = type.trim();
  if (TYPE_LABELS[key]) return TYPE_LABELS[key];
  return key.replace(/_/g, " ");
}

export function getNotificationCategoryLabel(
  category: NotificationCategory,
): string {
  const map: Record<NotificationCategory, string> = {
    video: "作品",
    slot: "枠",
    x_id: "X ID",
    event: "イベント",
    system: "システム",
    moderation: "モデレーション",
    chapter: "チャプター",
    announcement: "お知らせ",
    unknown: "その他",
  };
  return map[category];
}

/** manage UI のフィルタキーへ畳み込む */
export function toManageNotificationFilter(
  category: NotificationCategory,
): Exclude<ManageNotificationFilter, "all"> {
  if (
    category === "video" ||
    category === "slot" ||
    category === "x_id" ||
    category === "chapter"
  ) {
    return category;
  }
  return "other";
}

export function manageFilterMatchesType(
  type: string,
  filter: ManageNotificationFilter,
): boolean {
  if (filter === "all") return true;
  return toManageNotificationFilter(categorizeNotificationType(type)) === filter;
}

export const MANAGE_NOTIFICATION_FILTER_OPTIONS: ReadonlyArray<{
  key: ManageNotificationFilter;
  label: string;
}> = [
  { key: "all", label: "すべて" },
  { key: "video", label: "作品" },
  { key: "slot", label: "枠" },
  { key: "x_id", label: "X ID" },
  { key: "chapter", label: "チャプター" },
  { key: "other", label: "その他" },
];

export const ADMIN_NOTIFICATION_CATEGORY_OPTIONS: ReadonlyArray<{
  key: NotificationCategory | "all";
  label: string;
}> = [
  { key: "all", label: "すべて" },
  { key: "video", label: "作品" },
  { key: "slot", label: "枠" },
  { key: "x_id", label: "X ID" },
  { key: "chapter", label: "チャプター" },
  { key: "moderation", label: "モデレーション" },
  { key: "announcement", label: "お知らせ" },
  { key: "event", label: "イベント" },
  { key: "system", label: "システム" },
  { key: "unknown", label: "その他" },
];
