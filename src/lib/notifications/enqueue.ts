import "server-only";

import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { notificationOutbox } from "@/lib/db/schema";

type AnyDb = LibSQLDatabase<any>;

export interface EnqueueNotificationInput {
  /** 送信先 Discord ユーザー ID (notification_outbox.discord_user_id) */
  discordUserId: string;
  /** type 文字列 (例: x_id_approved, video_approved, slot_voided) */
  type: string;
  /** payload 任意 JSON。Worker がそのまま POST に使う前提 */
  payload: Record<string, unknown>;
  /** event-scoped 通知なら event_id を渡す (運営者受信箱で参照) */
  eventId?: string | null;
}

function randomId(): string {
  // crypto.randomUUID は edge ランタイムでも利用可。フォールバックなしで OK。
  return crypto.randomUUID();
}

/**
 * notification_outbox に 1 件 enqueue する。
 * 失敗してもアプリ操作は止めない (例外を呼び元に投げない)。
 */
export async function enqueueNotification(
  db: AnyDb,
  input: EnqueueNotificationInput,
): Promise<void> {
  try {
    await db.insert(notificationOutbox).values({
      id: randomId(),
      discord_user_id: input.discordUserId,
      type: input.type,
      payload_json: JSON.stringify(input.payload),
      status: "pending",
      attempt_count: 0,
      next_attempt_at: null,
      last_error: null,
      event_id: input.eventId ?? null,
      created_at: sql`(unixepoch())` as unknown as number,
    });
  } catch (e) {
    console.error("[enqueueNotification] failed", e);
  }
}
