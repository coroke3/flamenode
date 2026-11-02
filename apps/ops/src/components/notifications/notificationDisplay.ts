// Pure display helpers for notification_outbox rows, ported unchanged from
// src/lib/notifications/{types,display,status}.ts (MIG-0719 U03 parity). The CURRENT
// modules import drizzle and "@/" aliases, so the Ops SPA keeps a dependency-free copy.
import { isTerminalNotificationFailure } from "@flamenode/domain/admin";

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

const TYPE_LABELS: Record<string, string> = {
  video_submitted: "作品を受け付けました",
  video_approved: "作品が公開されました",
  video_voided: "作品について確認があります",
  video_pending: "作品が審査待ちになりました",
  video_private: "作品の公開範囲が変更されました",
  video_status_changed: "作品の状態が変更されました",
  video_edit_permission_granted: "編集権限が付与されました",
  slot_video_submitted: "枠投稿を受け付けました",
  slot_deadline_reminder: "投稿締切が近づいています",
  slot_force_released: "枠が解放されました",
  slot_submission_released: "枠の作品提出が解除されました",
  slot_voided: "枠が無効になりました",
  x_id_approved: "X ID が承認されました",
  x_id_rejected: "X ID が却下されました",
  x_id_alias_approved: "X ID エイリアスが承認されました",
  chapter_comment_added: "チャプターコメントが追加されました",
  moderation_created: "モデレーション案件が作成されました",
  announcement_broadcast: "お知らせ配信",
  terms_reaccept_required: "利用規約の再同意が必要です",
  welcome_account: "アカウント作成のお知らせ",
  discord_webhook: "運営チャンネル（Webhook）",
  ops_youtube_playlist_sync_failed: "YouTube再生リスト同期の失敗",
  ops_youtube_playlist_sync_recovered: "YouTube再生リスト同期の復旧",
  ops_youtube_quota_deferred: "YouTube再生リスト同期のquota延期",
};

const SEVERITY_BY_TYPE: Record<string, NotificationSeverity> = {
  video_voided: "critical",
  slot_force_released: "warning",
  slot_submission_released: "warning",
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
  welcome_account: "info",
  video_pending: "silent",
  ops_youtube_playlist_sync_failed: "critical",
  ops_youtube_playlist_sync_recovered: "info",
  ops_youtube_quota_deferred: "warning",
};

export function categorizeNotificationType(type: string): NotificationCategory {
  const t = type.trim();
  if (!t) return "unknown";
  if (t.startsWith("video_")) return "video";
  if (t.startsWith("slot_")) return "slot";
  if (t.startsWith("x_id_")) return "x_id";
  if (t.startsWith("chapter_")) return "chapter";
  if (t.startsWith("moderation_")) return "moderation";
  if (t.startsWith("announcement_")) return "announcement";
  if (t.startsWith("ops_")) return "system";
  if (t.startsWith("event_")) return "event";
  if (t === "discord_webhook" || t === "welcome_account") return "system";
  return "unknown";
}

export function getNotificationSeverity(type: string): NotificationSeverity {
  return SEVERITY_BY_TYPE[type] ?? "info";
}

export function getNotificationTypeLabel(type: string): string {
  const key = type.trim();
  return TYPE_LABELS[key] ?? key.replace(/_/g, " ");
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


export function getNotificationStatusLabel(status: string | null | undefined): string {
  if (!status) return "不明";
  return STATUS_LABELS[status] ?? status;
}
const STATUS_LABELS: Record<string, string> = {
  pending: "配信待ち",
  processing: "送信中",
  sent: "送信済み",
  failed: "失敗",
  dead_letter: "最終失敗",
  cancelled: "キャンセル",
};

export interface NotificationFailureGuidance {
  summary: string;
  nextSteps: string[];
}

/** 運営者向け: 失敗・滞留・運用キャンセル時の次アクション。 */
export function getNotificationFailureGuidance(input: {
  status: string | null | undefined;
  lastError: string | null | undefined;
  attemptCount: number | null | undefined;
}): NotificationFailureGuidance | null {
  const status = input.status ?? "";
  const err = (input.lastError ?? "").toLowerCase();
  const attempts = input.attemptCount ?? 0;

  if (status === "pending") {
    return {
      summary: "次の dispatcher 実行を待っています。",
      nextSteps: [
        "Queue wake で即時起動する。未処理なら毎時0分の fast-jobs Recovery Cron を待つ",
        "長時間 pending の場合は Worker cron と D1 接続を確認する",
      ],
    };
  }

  if (status === "processing") {
    return {
      summary: "送信処理中です。配送リースは5分で失効します。",
      nextSteps: [
        "配送リース（5分）超過後は毎時0分の fast-jobs Recovery Cron で自動回収される",
        "1時間以上 processing のままなら Worker と D1 を確認する",
      ],
    };
  }

  if (status === "cancelled") {
    if (err.includes("notification disabled")) {
      return {
        summary: "宛先の通知設定がOFFになったため、配送前に停止しました。",
        nextSteps: ["再送が必要な場合だけ通知設定を確認して強制再送する"],
      };
    }
    return {
      summary: "手動または運用ルールでキャンセル済みです。",
      nextSteps: ["再送が必要なら管理者画面から強制再送する"],
    };
  }

  if (!isTerminalNotificationFailure(status)) return null;

  if (err.includes("delivery lease expired") || err.includes("processing timeout")) {
    return {
      summary: "送信処理のリースが期限切れになりました。",
      nextSteps: [
        "Worker の実行履歴とD1接続を確認する",
        "原因解消後に通知を再試行する",
      ],
    };
  }

  if (err.includes("forum_webhook_unconfigured")) {
    const raw = input.lastError ?? "";
    const targetMatch = raw.match(
      /forum_webhook_unconfigured:(account|event|system)/i,
    );
    const forumSecretByTarget: Record<string, string> = {
      account: "DISCORD_WEBHOOK_URL_FORUM_ACCOUNT",
      event: "DISCORD_WEBHOOK_URL_FORUM_EVENT",
      system: "DISCORD_WEBHOOK_URL_FORUM_SYSTEM",
    };
    const targetKey = targetMatch?.[1]?.toLowerCase();
    const forumSecret = targetKey ? forumSecretByTarget[targetKey] : null;
    return {
      summary: "Forum 配信用 Discord Webhook URL が未設定です。",
      nextSteps: [
        forumSecret
          ? `${forumSecret} を確認する`
          : "DISCORD_WEBHOOK_URL_FORUM_ACCOUNT / DISCORD_WEBHOOK_URL_FORUM_EVENT / DISCORD_WEBHOOK_URL_FORUM_SYSTEM を確認する",
        "legacy の DISCORD_WEBHOOK_URL は webhook_target 無しの旧通知行のみに適用される",
        "設定修正後に失敗通知を再試行する",
      ],
    };
  }

  if (err.includes("webhook_unconfigured")) {
    return {
      summary: "Discord Webhook URL が未設定です。",
      nextSteps: [
        "DISCORD_WEBHOOK_URL_FORUM_ACCOUNT / DISCORD_WEBHOOK_URL_FORUM_EVENT / DISCORD_WEBHOOK_URL_FORUM_SYSTEM、または移行用 legacy DISCORD_WEBHOOK_URL を確認する",
        "設定修正後に失敗通知を再試行する",
      ],
    };
  }

  if (
    err.includes("bot_token_unconfigured") ||
    err.includes("401") ||
    err.includes("unauthorized")
  ) {
    return {
      summary: "Discord Bot の認証設定に問題があります。",
      nextSteps: [
        "DISCORD_BOT_TOKEN を確認する",
        "設定修正後に失敗通知を再試行する",
      ],
    };
  }

  if (err.includes("403") || err.includes("cannot send")) {
    return {
      summary: "宛先がBotのDMを受け取れない可能性があります。",
      nextSteps: [
        "宛先がBotとサーバーを共有し、DMを許可しているか確認する",
        "必要ならサイト内または運営Discordで別途連絡する",
      ],
    };
  }

  if (err.includes("recipient_missing") || err.includes("404")) {
    return {
      summary: "有効なDiscord宛先を解決できませんでした。",
      nextSteps: [
        "ユーザーのDiscord連携状態を確認する",
        "連携解除済みなら再送せずキャンセルする",
      ],
    };
  }

  if (
    err.includes("rate") ||
    err.includes("429") ||
    err.includes("cooldown")
  ) {
    return {
      summary: "Discordのレート制限に達した可能性があります。",
      nextSteps: [
        "Discord指定の待機時間を空ける",
        "短時間に通知が集中していないか確認する",
      ],
    };
  }

  if (
    err.includes("timeout") ||
    err.includes("network") ||
    err.includes("request_budget")
  ) {
    return {
      summary: "Discord通信または無料枠内の実行予算で失敗しました。",
      nextSteps: [
        "一時障害なら時間を空けて再試行する",
        "繰り返す場合はWorkerログと外部通信件数を確認する",
      ],
    };
  }

  return {
    summary: `配送を完了できませんでした（試行 ${attempts} 回）。`,
    nextSteps: [
      "payloadと宛先のDiscord連携状態を確認する",
      "原因解消後に再試行する",
      "繰り返す場合はDiscord側の応答とWorkerログを確認する",
    ],
  };
}

export function summarizeNotificationPayload(
  payloadJson: string,
): {
  preview: string;
  fullContent: string;
  videoId?: string;
  eventId?: string;
} {
  try {
    const obj = JSON.parse(payloadJson) as Record<string, unknown>;
    const content =
      typeof obj.content === "string" ? obj.content.trim() : "";
    const firstLine = content.split("\n").find((line) => line.trim()) ?? "";
    const preview =
      firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine || "—";
    return {
      preview,
      fullContent: content || "—",
      videoId: typeof obj.video_id === "string" ? obj.video_id : undefined,
      eventId: typeof obj.event_id === "string" ? obj.event_id : undefined,
    };
  } catch {
    return { preview: "—", fullContent: "—" };
  }
}

/** 運営画面向け: last_error を日本語要約へ変換する。 */
export function translateNotificationError(
  lastError: string | null | undefined,
): string | null {
  const err = (lastError ?? "").trim();
  if (!err) return null;
  const lower = err.toLowerCase();
  if (lower.includes("discord_channel_webhook_unconfigured")) {
    return "運営チャンネル用 Webhook URL (DISCORD_WEBHOOK_URL) が未設定です。";
  }
  if (lower.includes("discord_dm_bot_token_unconfigured")) {
    return "利用者 DM 用 Bot Token (DISCORD_BOT_TOKEN) が未設定です。";
  }
  if (lower.includes("discord_recipient_missing")) {
    return "宛先ユーザーの Discord ID が未連携のため、DM を配送できません。";
  }
  if (lower.includes("discord_payload_invalid")) {
    return "通知 payload が Discord API 形式として不正です。";
  }
  return err;
}

export function severityBadgeClass(
  severity: NotificationSeverity,
): string {
  switch (severity) {
    case "critical":
      return "fn-badge-danger";
    case "warning":
      return "fn-badge-warning";
    case "silent":
      return "fn-badge-soft";
    default:
      return "fn-badge-soft";
  }
}

export function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "sent":
      return "fn-badge-accent";
    case "failed":
    case "dead_letter":
      return "fn-badge-danger";
    case "processing":
      return "fn-badge-warning";
    default:
      return "fn-badge-soft";
  }
}

export function formatNotificationRowTitle(type: string): {
  label: string;
  category: NotificationCategory;
  categoryLabel: string;
  severity: NotificationSeverity;
} {
  const category = categorizeNotificationType(type);
  return {
    label: getNotificationTypeLabel(type),
    category,
    categoryLabel: getNotificationCategoryLabel(category),
    severity: getNotificationSeverity(type),
  };
}

export function notificationDeliveryRoute(type: string): "dm" | "channel" {
  return type === "discord_webhook" ? "channel" : "dm";
}

export function notificationDeliveryRouteLabel(type: string): string {
  return notificationDeliveryRoute(type) === "channel" ? "チャンネル（Webhook）" : "DM（Bot）";
}
