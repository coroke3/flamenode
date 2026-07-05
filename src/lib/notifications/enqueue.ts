import "server-only";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { DB } from "@/lib/db/client";
import { accounts, notificationOutbox, users, xUsers } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import { shouldEnqueueUserNotification } from "./context";
import { validateNotificationPayload } from "./format";

type AnyDb = LibSQLDatabase<any>;
const DISCORD_SNOWFLAKE_RE = /^\d{15,22}$/;

export interface EnqueueNotificationInput {
  /** 送信先 Discord ユーザー ID (users.id / discord_id / accounts から解決可) */
  discordUserId?: string | null;
  /** x_users.id 指定時は linked_discord_user_id を解決 */
  xUserId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  eventId?: string | null;
  dedupeKey?: string | null;
  force?: boolean;
}

function randomId(): string {
  return crypto.randomUUID();
}

async function resolveDiscordRecipientId(
  db: AnyDb,
  input: EnqueueNotificationInput,
  force = false,
): Promise<string | null> {
  const candidate = input.discordUserId?.trim();
  if (candidate) {
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
    return (
      row?.provider_account_id ??
      row?.discord_id ??
      (DISCORD_SNOWFLAKE_RE.test(candidate) ? candidate : null)
    );
  }

  const xId = input.xUserId?.trim();
  if (!xId) return null;
  const xRow = (
    await db
      .select({ linked: xUsers.linked_discord_user_id })
      .from(xUsers)
      .where(eq(xUsers.id, xId))
      .limit(1)
  )[0];
  const linked = xRow?.linked?.trim();
  if (!linked || !DISCORD_SNOWFLAKE_RE.test(linked)) return null;
  if (!force) {
    const userRow = (
      await db
        .select({ is_notification_enabled: users.is_notification_enabled })
        .from(users)
        .where(eq(users.discord_id, linked))
        .limit(1)
    )[0];
    if (userRow?.is_notification_enabled === 0) return null;
  }
  return linked;
}

async function hasActiveDedupe(
  db: AnyDb,
  dedupeKey: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.dedupe_key, dedupeKey),
        inArray(notificationOutbox.status, ["pending", "processing", "sent"]),
      )!,
    )
    .limit(1);
  return existing.length > 0;
}

/**
 * notification_outbox に 1 件 enqueue する。
 * 失敗してもアプリ操作は止めない (例外を呼び元に投げない)。
 */
export async function enqueueNotification(
  db: AnyDb,
  input: EnqueueNotificationInput,
): Promise<boolean> {
  if (!shouldEnqueueUserNotification()) {
    return false;
  }

  const check = validateNotificationPayload(input.type, input.payload);
  if (!check.ok) {
    console.warn("[enqueueNotification] invalid payload:", check.reason, input.type);
    return false;
  }

  const dedupeKey = input.dedupeKey?.trim() || null;
  if (dedupeKey && !input.force) {
    try {
      if (await hasActiveDedupe(db, dedupeKey)) {
        return false;
      }
    } catch (e) {
      console.warn("[enqueueNotification] dedupe check failed", e);
    }
  }

  try {
    const discordRecipientId = await resolveDiscordRecipientId(
      db,
      input,
      input.force ?? false,
    );
    if (!discordRecipientId) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
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
      dedupe_key: dedupeKey,
      created_at: now,
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (dedupeKey && /UNIQUE|unique/i.test(msg)) {
      return false;
    }
    console.warn("[enqueueNotification] failed", e);
    try {
      await auditAction(db as DB, {
        table_name: "notification_outbox",
        record_id: "enqueue_failed",
        action: "CREATE",
        after_data: JSON.stringify({
          type: input.type,
          dedupe_key: dedupeKey,
          error: msg.slice(0, 500),
        }),
        operator_discord_id: input.discordUserId ?? "system",
        retention_class: "normal",
      });
    } catch {
      // history 失敗は握りつぶす
    }
    return false;
  }
}
