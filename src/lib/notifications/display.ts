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

export type OutboxStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "cancelled";

const STATUS_LABELS: Record<OutboxStatus, string> = {
  pending: "配信待ち",
  processing: "送信中",
  sent: "送信済み",
  failed: "失敗",
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

/** 運営者向け: 失敗・滞留時の次アクション */
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
        "5分以内に processing / sent へ進むか確認する",
        "長時間 pending の場合は Worker cron と D1 接続を確認する",
      ],
    };
  }

  if (status === "processing") {
    return {
      summary: "送信中です。15分超で固着した場合は rescue されます。",
      nextSteps: [
        "15分経過後も processing のままなら手動キャンセルまたは再試行",
        "同時刻帯に大量 enqueue が無いか確認する",
      ],
    };
  }

  if (status === "cancelled") {
    return {
      summary: "手動または運用でキャンセル済みです。",
      nextSteps: ["再送が必要なら管理者画面から強制再送する"],
    };
  }

  if (status !== "failed") return null;

  if (err.includes("processing timeout")) {
    return {
      summary: "送信処理がタイムアウトしました。",
      nextSteps: [
        "再試行で pending に戻す",
        "Discord API の障害状況を確認する",
      ],
    };
  }
  if (err.includes("401") || err.includes("unauthorized")) {
    return {
      summary: "Discord Bot トークンが無効の可能性があります。",
      nextSteps: [
        "DISCORD_BOT_TOKEN を確認する",
        "修正後に failed を再試行する",
      ],
    };
  }
  if (err.includes("403") || err.includes("cannot send")) {
    return {
      summary: "ユーザーが DM を受け取れない可能性があります。",
      nextSteps: [
        "宛先ユーザーが Bot とサーバー共有・DM 許可しているか確認",
        "必要ならサイト内で別途連絡する",
      ],
    };
  }
  if (err.includes("404")) {
    return {
      summary: "Discord ユーザーが見つかりません。",
      nextSteps: [
        "discord_user_id が正しいか users / accounts を確認",
        "連携解除済みなら通知をキャンセルする",
      ],
    };
  }
  if (err.includes("rate") || err.includes("429")) {
    return {
      summary: "Discord のレート制限に達した可能性があります。",
      nextSteps: [
        "しばらく待ってから再試行する",
        "短時間の大量配信を避ける",
      ],
    };
  }

  return {
    summary: `最大試行回数に達しました (試行 ${attempts} 回)。`,
    nextSteps: [
      "payload を確認し文面・URL が妥当か見る",
      "再試行または強制再送で pending に戻す",
      "繰り返す場合は Discord 側のエラーログを確認する",
    ],
  };
}

export function summarizeNotificationPayload(
  payloadJson: string,
): { preview: string; videoId?: string; eventId?: string } {
  try {
    const obj = JSON.parse(payloadJson) as Record<string, unknown>;
    const content =
      typeof obj.content === "string" ? obj.content.trim() : "";
    const firstLine = content.split("\n").find((l) => l.trim()) ?? "";
    const preview =
      firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine || "—";
    return {
      preview,
      videoId:
        typeof obj.video_id === "string" ? obj.video_id : undefined,
      eventId:
        typeof obj.event_id === "string" ? obj.event_id : undefined,
    };
  } catch {
    return { preview: "—" };
  }
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
      return "fn-badge-danger";
    case "processing":
      return "fn-badge-warning";
    default:
      return "fn-badge-soft";
  }
}

/** Drizzle: カテゴリで type を絞る (event_id 条件は呼び元で AND) */
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

/** /manage: other = video/slot/x_id/chapter 以外 */
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
