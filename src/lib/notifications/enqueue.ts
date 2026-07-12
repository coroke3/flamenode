import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { DB } from "@/lib/db/client";
import { notificationOutbox, users, xUsers } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import { shouldEnqueueUserNotification } from "./context";
import { validateNotificationPayload } from "./format";

type AnyDb = LibSQLDatabase<any>;
export interface EnqueueNotificationInput {
  /** 送信先の Auth.js 内部ユーザー ID。 */
  recipientUserId?: string | null;
  /** x_users.id 指定時は linked_user_id を解決 */
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

async function resolveRecipientUserId(
  db: AnyDb,
  input: EnqueueNotificationInput,
  force = false,
): Promise<string | null> {
  const candidate = input.recipientUserId?.trim();
  if (candidate) {
    const rows = await db
      .select({
        id: users.id,
        is_notification_enabled: users.is_notification_enabled,
      })
      .from(users)
      .where(eq(users.id, candidate))
      .limit(1);
    const row = rows[0];
    if (!force && row?.is_notification_enabled === 0) return null;
    return row?.id ?? null;
  }

  const xId = input.xUserId?.trim();
  if (!xId) return null;
  const xRow = (
    await db
      .select({ linked: xUsers.linked_user_id })
      .from(xUsers)
      .where(eq(xUsers.id, xId))
      .limit(1)
  )[0];
  const linkedUserId = xRow?.linked?.trim();
  if (!linkedUserId) return null;
  const userRow = (
    await db
      .select({ id: users.id, is_notification_enabled: users.is_notification_enabled })
      .from(users)
      .where(eq(users.id, linkedUserId))
      .limit(1)
  )[0];
  if (!userRow || (!force && userRow.is_notification_enabled === 0)) return null;
  return userRow.id;
}

/**
 * 通知の宛先・dedupe・payload を事前検証し、呼び出し側の D1 batch に
 * そのまま追加できる outbox INSERT を返す。INSERT 自体は swallow せず、
 * 本体 mutation と同じ batch の rollback 条件にする。
 */
export async function buildNotificationOutboxStatement(
  db: AnyDb,
  input: EnqueueNotificationInput,
): Promise<BatchItem<"sqlite"> | null> {
  if (!shouldEnqueueUserNotification()) return null;

  const check = validateNotificationPayload(input.type, input.payload);
  if (!check.ok) throw new Error(`通知 payload が不正です: ${check.reason}`);

  const dedupeKey = input.dedupeKey?.trim() || null;
  if (dedupeKey && !input.force && (await hasActiveDedupe(db, dedupeKey))) {
    return null;
  }

  const recipientUserId = await resolveRecipientUserId(db, input, input.force ?? false);
  if (!recipientUserId) return null;

  const now = Math.floor(Date.now() / 1000);
  return db.insert(notificationOutbox).values({
    id: randomId(),
    recipient_user_id: recipientUserId,
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
    const recipientUserId = await resolveRecipientUserId(
      db,
      input,
      input.force ?? false,
    );
    if (!recipientUserId) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    await db.insert(notificationOutbox).values({
      id: randomId(),
      recipient_user_id: recipientUserId,
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
        operator_user_id: input.recipientUserId ?? "system",
        retention_class: "normal",
      });
    } catch {
      // history 失敗は握りつぶす
    }
    return false;
  }
}
