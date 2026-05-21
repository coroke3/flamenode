import "server-only";

import { and, eq, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { accounts, notificationOutbox, users } from "@/lib/db/schema";
import { validateNotificationPayload } from "./format";

type AnyDb = LibSQLDatabase<any>;
const DISCORD_SNOWFLAKE_RE = /^\d{15,22}$/;

export interface EnqueueNotificationInput {
  /** 送信先 Discord ユーザー ID (notification_outbox.discord_user_id) */
  discordUserId: string;
  /** type 文字列 (例: x_id_approved, video_approved, slot_voided) */
  type: string;
  /** payload 任意 JSON。Worker がそのまま POST に使う前提 */
  payload: Record<string, unknown>;
  /** event-scoped 通知なら event_id を渡す (運営者受信箱で参照) */
  eventId?: string | null;
  force?: boolean;
}

function randomId(): string {
  // crypto.randomUUID は edge ランタイムでも利用可。フォールバックなしで OK。
  return crypto.randomUUID();
}

async function resolveDiscordRecipientId(
  db: AnyDb,
  candidate: string,
  force = false,
): Promise<string | null> {
  const rows = await db
    .select({
      discord_id: users.discord_id,
      provider_account_id: accounts.providerAccountId,
      is_notification_enabled: users.is_notification_enabled,
    })
    .from(users)
    .leftJoin(
      accounts,
      and(eq(accounts.userId, users.id), eq(accounts.provider, "discord"))!,
    )
    .where(
      or(
        eq(users.id, candidate),
        eq(users.discord_id, candidate),
        eq(accounts.providerAccountId, candidate),
      )!,
    )
    .limit(1);
  const row = rows[0];
  if (!force && row?.is_notification_enabled === 0) return null;
  return row?.provider_account_id ??
    row?.discord_id ??
    (DISCORD_SNOWFLAKE_RE.test(candidate) ? candidate : null);
}

/**
 * notification_outbox に 1 件 enqueue する。
 * 失敗してもアプリ操作は止めない (例外を呼び元に投げない)。
 */
export async function enqueueNotification(
  db: AnyDb,
  input: EnqueueNotificationInput,
): Promise<boolean> {
  const check = validateNotificationPayload(input.type, input.payload);
  if (!check.ok) {
    console.error("[enqueueNotification] invalid payload:", check.reason, input);
    return false;
  }
  if (!input.discordUserId) {
    console.error("[enqueueNotification] discordUserId が空のため skip");
    return false;
  }
  try {
    const discordRecipientId = await resolveDiscordRecipientId(
      db,
      input.discordUserId,
      input.force ?? false,
    );
    if (!discordRecipientId) {
      console.error("[enqueueNotification] Discord recipient ID を解決できないため skip");
      return false;
    }
    await db.insert(notificationOutbox).values({
      id: randomId(),
      discord_user_id: discordRecipientId,
      type: input.type,
      payload_json: JSON.stringify(input.payload),
      status: "pending",
      attempt_count: 0,
      processing_started_at: null,
      next_attempt_at: null,
      last_error: null,
      event_id: input.eventId ?? null,
      created_at: sql`(unixepoch())` as unknown as number,
    });
    return true;
  } catch (e) {
    console.error("[enqueueNotification] failed", e);
    return false;
  }
}
