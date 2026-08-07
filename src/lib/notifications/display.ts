import { and, like, or, sql, type SQL } from "drizzle-orm";
import type { notificationOutbox } from "@/lib/db/schema";
import {
  categorizeNotificationType,
  getNotificationCategoryLabel,
  getNotificationSeverity,
  getNotificationTypeLabel,
  type NotificationCategory,
  type NotificationSeverity,
} from "./types";
import {
  isTerminalNotificationFailure,
  type NotificationOutboxStatus,
} from "./status";
import {
  notificationDeliveryRoute,
  notificationDeliveryRouteLabel,
} from "./opsWebhook";

export { notificationDeliveryRoute, notificationDeliveryRouteLabel };

export type OutboxStatus = NotificationOutboxStatus;

const STATUS_LABELS: Record<OutboxStatus, string> = {
  pending: "配信待ち",
  processing: "送信中",
  sent: "送信済み",
  failed: "失敗",
  dead_letter: "最終失敗",
  cancelled: "キャンセル",
};

export function getNotificationStatusLabel(
  status: string | null | undefined,
): string {
  if (!status) return "不明";
  return STATUS_LABELS[status as OutboxStatus] ?? status;
}

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
    return {
      summary: "Forum 配信用 Discord Webhook URL が未設定です。",
      nextSteps: [
        "DISCORD_WEBHOOK_URL_FORUM_ACCOUNT / DISCORD_WEBHOOK_URL_FORUM_EVENT / DISCORD_WEBHOOK_URL_FORUM_SYSTEM を確認する",
        "移行中は legacy の DISCORD_WEBHOOK_URL も利用可能",
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

/** Drizzle: カテゴリで type を絞る (event_id 条件は呼び元で AND)。 */
export function drizzleNotificationCategoryCondition(
  category: NotificationCategory,
  typeColumn: typeof notificationOutbox.type,
): SQL {
  switch (category) {
    case "video":
      return like(typeColumn, "video_%");
    case "slot":
      return like(typeColumn, "slot_%");
    case "x_id":
      return like(typeColumn, "x_id_%");
    case "chapter":
      return like(typeColumn, "chapter_%");
    case "moderation":
      return like(typeColumn, "moderation_%");
    case "announcement":
      return like(typeColumn, "announcement_%");
    case "event":
      return like(typeColumn, "event_%");
    case "system":
      return sql`${typeColumn} = 'discord_webhook'`;
    case "unknown":
      return and(
        sql`${typeColumn} NOT LIKE 'video_%'`,
        sql`${typeColumn} NOT LIKE 'slot_%'`,
        sql`${typeColumn} NOT LIKE 'x_id_%'`,
        sql`${typeColumn} NOT LIKE 'chapter_%'`,
        sql`${typeColumn} NOT LIKE 'moderation_%'`,
        sql`${typeColumn} NOT LIKE 'announcement_%'`,
        sql`${typeColumn} NOT LIKE 'event_%'`,
        sql`${typeColumn} != 'discord_webhook'`,
      )!;
    default:
      return sql`1=1`;
  }
}

/** /manage: other = video/slot/x_id/chapter 以外。 */
export function drizzleManageNotificationFilter(
  filter: Exclude<import("./types").ManageNotificationFilter, "all">,
  typeColumn: typeof notificationOutbox.type,
): SQL {
  if (filter === "other") {
    return or(
      drizzleNotificationCategoryCondition("unknown", typeColumn),
      drizzleNotificationCategoryCondition("system", typeColumn),
      drizzleNotificationCategoryCondition("event", typeColumn),
      drizzleNotificationCategoryCondition("moderation", typeColumn),
      drizzleNotificationCategoryCondition("announcement", typeColumn),
    )!;
  }
  return drizzleNotificationCategoryCondition(filter, typeColumn);
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
