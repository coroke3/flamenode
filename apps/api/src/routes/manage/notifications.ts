import type { ManageNotificationWithRecipient } from "@flamenode/contracts";
import { jsonObject, type Piece } from "./events.ts";

// CURRENT: src/lib/notifications/display.ts (drizzleNotificationCategoryCondition, drizzleManageNotificationFilter),
// src/lib/notifications/types.ts (categorizeNotificationType), src/lib/notifications/recipient.ts (lookupNotificationRecipients).
// The recipient lookup is a LEFT JOIN on "user" inside the same bounded statement (no extra statement).

export type ManageNotifFilter = "all" | "video" | "x_id" | "slot" | "chapter" | "other";
type Category = "video" | "slot" | "x_id" | "chapter" | "moderation" | "announcement" | "event" | "system" | "unknown";

export function parseNotifFilter(raw: string | undefined): ManageNotifFilter {
  return raw === "video" || raw === "x_id" || raw === "slot" || raw === "chapter" || raw === "other" ? raw : "all";
}

/** CURRENT categorizeNotificationType. */
export function categorizeNotificationType(type: string): Category {
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

function categoryCondition(category: Category, col: string): string {
  switch (category) {
    case "video":
      return `${col} LIKE 'video_%'`;
    case "slot":
      return `${col} LIKE 'slot_%'`;
    case "x_id":
      return `${col} LIKE 'x_id_%'`;
    case "chapter":
      return `${col} LIKE 'chapter_%'`;
    case "moderation":
      return `${col} LIKE 'moderation_%'`;
    case "announcement":
      return `${col} LIKE 'announcement_%'`;
    case "event":
      return `${col} LIKE 'event_%'`;
    case "system":
      return `${col} = 'discord_webhook'`;
    default:
      return [
        `${col} NOT LIKE 'video_%'`,
        `${col} NOT LIKE 'slot_%'`,
        `${col} NOT LIKE 'x_id_%'`,
        `${col} NOT LIKE 'chapter_%'`,
        `${col} NOT LIKE 'moderation_%'`,
        `${col} NOT LIKE 'announcement_%'`,
        `${col} NOT LIKE 'event_%'`,
        `${col} != 'discord_webhook'`,
      ].join(" AND ");
  }
}

/** CURRENT drizzleManageNotificationFilter as a SQL condition (no bind parameters), or null for "all". */
export function notifFilterCondition(filter: ManageNotifFilter, col: string): string | null {
  if (filter === "all") return null;
  if (filter === "other") {
    return `((${categoryCondition("unknown", col)}) OR (${categoryCondition("system", col)}) OR (${categoryCondition("event", col)}) OR (${categoryCondition("moderation", col)}) OR (${categoryCondition("announcement", col)}))`;
  }
  return `(${categoryCondition(filter, col)})`;
}

const ROW_COLUMNS = [
  "id",
  "type",
  "status",
  "payload_json",
  "attempt_count",
  "last_error",
  "dedupe_key",
  "recipient_user_id",
  "event_id",
  "created_at",
  "recipient_name",
  "recipient_discord_id",
  "recipient_enabled",
] as const;

/** Newest-first notification rows (with recipient lookup) for a WHERE on alias `n`. */
export function notificationRowsPiece(where: string, params: unknown[], limit: number): Piece {
  return {
    sql: `(SELECT json_group_array(json_object(${jsonObject(ROW_COLUMNS)})) FROM (
        SELECT n.id AS id, n.type AS type, n.status AS status, n.payload_json AS payload_json,
          n.attempt_count AS attempt_count, n.last_error AS last_error, n.dedupe_key AS dedupe_key,
          n.recipient_user_id AS recipient_user_id, n.event_id AS event_id, n.created_at AS created_at,
          u.name AS recipient_name, u.discord_id AS recipient_discord_id,
          CASE WHEN u.id IS NULL THEN NULL WHEN u.is_notification_enabled = 0 THEN 0 ELSE 1 END AS recipient_enabled
        FROM notification_outbox n
        LEFT JOIN "user" u ON u.id = n.recipient_user_id
        WHERE ${where}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ?) q)`,
    params: [...params, limit],
  };
}

export interface RawNotificationRow {
  id: string;
  type: string;
  status: string | null;
  payload_json: string;
  attempt_count: number | null;
  last_error: string | null;
  dedupe_key: string | null;
  recipient_user_id: string | null;
  event_id: string | null;
  created_at: number;
  recipient_name: string | null;
  recipient_discord_id: string | null;
  recipient_enabled: number | null;
}

export function toNotification(row: RawNotificationRow): ManageNotificationWithRecipient {
  const { recipient_name, recipient_discord_id, recipient_enabled, ...rest } = row;
  return {
    ...rest,
    recipient:
      recipient_enabled === null
        ? null
        : { userName: recipient_name, discordId: recipient_discord_id, notificationsEnabled: recipient_enabled === 1 },
  };
}
