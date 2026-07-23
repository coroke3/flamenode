import type { LibSQLDatabase } from "drizzle-orm/libsql";

import {
  buildNotificationOutboxStatement,
  type NotificationOutboxStatement,
} from "./enqueue";

type AnyDb = LibSQLDatabase<any>;

/** 運営 Discord チャンネル（Webhook）向け outbox statement を組み立てる。 */
export async function buildOpsChannelWebhookStatement(
  db: AnyDb,
  input: {
    actorUserId: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
    eventId?: string | null;
  },
): Promise<NotificationOutboxStatement | null> {
  return buildNotificationOutboxStatement(db, {
    recipientUserId: input.actorUserId,
    type: "discord_webhook",
    payload: input.payload,
    dedupeKey: input.dedupeKey,
    eventId: input.eventId ?? null,
    force: true,
  });
}

/** 通知種別が DM 経路かチャンネル（Webhook）経路かを返す。 */
export function notificationDeliveryRoute(
  type: string,
): "dm" | "channel" {
  return type === "discord_webhook" ? "channel" : "dm";
}

export function notificationDeliveryRouteLabel(type: string): string {
  return notificationDeliveryRoute(type) === "channel"
    ? "チャンネル（Webhook）"
    : "DM（Bot）";
}
