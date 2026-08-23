import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { notificationOutbox, users, xUserAccountLinks } from "@/lib/db/schema";

import { validateNotificationPayload } from "./format";

type AnyDb = LibSQLDatabase<any>;
type InsertResult = { meta?: { changes?: number } };

export interface EnqueueNotificationInput {
  /** 送信先の Auth.js 内部ユーザー ID。 */
  recipientUserId?: string | null;
  /** x_users.id 指定時は x_user_account_links から通知先を解決 */
  xUserId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  eventId?: string | null;
  dedupeKey?: string | null;
  force?: boolean;
}

type KnownRecipientNotificationInput = Omit<
  EnqueueNotificationInput,
  "recipientUserId" | "xUserId" | "force"
> & {
  recipientUserId: string;
};

type NotificationOutboxBatch = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: null[];
  rows: Array<typeof notificationOutbox.$inferSelect>;
};

/**
 * Drizzle の query builder は PromiseLike なので、async 関数から直接返すと
 * Promise resolution によって即時実行される。statement を envelope に入れ、
 * 呼び出し側が D1 batch へ追加するまで未実行のまま保持する。
 */
export type NotificationOutboxStatement = Readonly<{
  statement: BatchItem<"sqlite">;
}>;

type PreparedNotification = {
  type: string;
  payloadJson: string;
  eventId: string | null;
  dedupeKey: string | null;
};

function prepareNotification(
  input: Pick<
    EnqueueNotificationInput,
    "type" | "payload" | "eventId" | "dedupeKey"
  >,
): PreparedNotification {
  const check = validateNotificationPayload(input.type, input.payload);
  if (!check.ok) {
    throw new Error(`通知 payload が不正です: ${check.reason}`);
  }
  return {
    type: input.type,
    payloadJson: JSON.stringify(input.payload),
    eventId: input.eventId ?? null,
    dedupeKey: input.dedupeKey?.trim() || null,
  };
}

function buildNotificationRow(
  prepared: PreparedNotification,
  recipientUserId: string,
  now: number,
): typeof notificationOutbox.$inferSelect {
  return {
    id: crypto.randomUUID(),
    recipient_user_id: recipientUserId,
    type: prepared.type,
    payload_json: prepared.payloadJson,
    status: "pending",
    attempt_count: 0,
    processing_started_at: null,
    lease_token: null,
    lease_expires_at: null,
    next_attempt_at: null,
    last_error: null,
    processed_at: null,
    event_id: prepared.eventId,
    dedupe_key: prepared.dedupeKey,
    created_at: now,
  };
}

function insertNotificationStatement(
  db: AnyDb,
  row: typeof notificationOutbox.$inferSelect,
): BatchItem<"sqlite"> {
  // active dedupe partial uniqueとの競合は「既にenqueue済み」という成功扱い。
  return db.insert(notificationOutbox).values(row).onConflictDoNothing();
}

async function executeNotificationInsert(
  db: AnyDb,
  row: typeof notificationOutbox.$inferSelect,
): Promise<boolean> {
  const result = (await db
    .insert(notificationOutbox)
    .values(row)
    .onConflictDoNothing()) as InsertResult;
  return (result.meta?.changes ?? 0) === 1;
}

/**
 * 事前に権限・通知可否を一括取得済みの宛先向けbuilder。
 * required_atomic用途だが、同一dedupeの並行enqueueだけはidempotentに無視する。
 */
export async function buildKnownRecipientNotificationBatch(
  db: AnyDb,
  inputs: readonly KnownRecipientNotificationInput[],
): Promise<NotificationOutboxBatch> {
  if (inputs.length === 0) {
    return { statements: [], expectedChanges: [], rows: [] };
  }
  if (inputs.length > 30) throw new Error("notification_batch_limit_exceeded");

  const preparedInputs = inputs.map((input) => ({
    input,
    prepared: prepareNotification(input),
  }));
  const nonNullKeys = preparedInputs
    .map(({ prepared }) => prepared.dedupeKey)
    .filter((key): key is string => key !== null);
  if (new Set(nonNullKeys).size !== nonNullKeys.length) {
    throw new Error("notification_batch_duplicate_dedupe_key");
  }

  const active =
    nonNullKeys.length === 0
      ? []
      : await db
          .select({ dedupe_key: notificationOutbox.dedupe_key })
          .from(notificationOutbox)
          .where(
            and(
              inArray(notificationOutbox.dedupe_key, nonNullKeys),
              inArray(notificationOutbox.status, [
                "pending",
                "processing",
                "sent",
              ]),
            )!,
          )
          .limit(inputs.length + 1);
  const existing = new Set(
    active
      .map((row) => row.dedupe_key)
      .filter((value): value is string => Boolean(value)),
  );
  const now = Math.floor(Date.now() / 1000);
  const statements: BatchItem<"sqlite">[] = [];
  const rows: Array<typeof notificationOutbox.$inferSelect> = [];

  for (const { input, prepared } of preparedInputs) {
    const recipientUserId = input.recipientUserId.trim();
    if (!recipientUserId) throw new Error("notification_recipient_required");
    if (prepared.dedupeKey && existing.has(prepared.dedupeKey)) continue;
    const row = buildNotificationRow(prepared, recipientUserId, now);
    rows.push(row);
    statements.push(insertNotificationStatement(db, row));
  }

  return {
    statements,
    expectedChanges: statements.map(() => null),
    rows,
  };
}

/**
 * 大人数のrequired_atomic通知向けJSON1 builder。
 * 1 recipient = 1 D1 statement にせず、最大200件を1 statementへまとめる。
 * active dedupe partial uniqueとの競合は INSERT OR IGNORE でidempotentに扱うため、
 * expectedChangesはnullとする。payload自体はbind parameterのまま保持すること。
 */
export async function buildKnownRecipientNotificationBulkBatch(
  db: AnyDb,
  inputs: readonly KnownRecipientNotificationInput[],
): Promise<NotificationOutboxBatch> {
  if (inputs.length === 0) {
    return { statements: [], expectedChanges: [], rows: [] };
  }
  if (inputs.length > 200) throw new Error("notification_bulk_batch_limit_exceeded");

  const preparedInputs = inputs.map((input) => ({
    input,
    prepared: prepareNotification(input),
  }));
  const nonNullKeys = preparedInputs
    .map(({ prepared }) => prepared.dedupeKey)
    .filter((key): key is string => key !== null);
  if (new Set(nonNullKeys).size !== nonNullKeys.length) {
    throw new Error("notification_batch_duplicate_dedupe_key");
  }

  const now = Math.floor(Date.now() / 1000);
  const rows = preparedInputs.map(({ input, prepared }) => {
    const recipientUserId = input.recipientUserId.trim();
    if (!recipientUserId) throw new Error("notification_recipient_required");
    return buildNotificationRow(prepared, recipientUserId, now);
  });
  const payload = JSON.stringify(rows);
  const statement = db.run(sql`
    INSERT OR IGNORE INTO notification_outbox (
      id,
      recipient_user_id,
      type,
      payload_json,
      status,
      attempt_count,
      processing_started_at,
      lease_token,
      lease_expires_at,
      next_attempt_at,
      last_error,
      processed_at,
      event_id,
      dedupe_key,
      created_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.recipient_user_id'),
      json_extract(value, '$.type'),
      json_extract(value, '$.payload_json'),
      json_extract(value, '$.status'),
      json_extract(value, '$.attempt_count'),
      json_extract(value, '$.processing_started_at'),
      json_extract(value, '$.lease_token'),
      json_extract(value, '$.lease_expires_at'),
      json_extract(value, '$.next_attempt_at'),
      json_extract(value, '$.last_error'),
      json_extract(value, '$.processed_at'),
      json_extract(value, '$.event_id'),
      json_extract(value, '$.dedupe_key'),
      json_extract(value, '$.created_at')
    FROM json_each(${payload})
  `);

  return {
    statements: [statement],
    expectedChanges: [null],
    rows,
  };
}

async function resolveRecipientUserId(
  db: AnyDb,
  input: EnqueueNotificationInput,
  force = false,
): Promise<string | null> {
  const candidate = input.recipientUserId?.trim();
  if (candidate) {
    const row = (
      await db
        .select({
          id: users.id,
          is_notification_enabled: users.is_notification_enabled,
        })
        .from(users)
        .where(eq(users.id, candidate))
        .limit(1)
    )[0];
    if (!row || (!force && row.is_notification_enabled === 0)) return null;
    return row.id;
  }

  const xId = input.xUserId?.trim();
  if (!xId) return null;
  const row = (
    await db
      .select({
        id: users.id,
        is_notification_enabled: users.is_notification_enabled,
      })
      .from(xUserAccountLinks)
      .innerJoin(users, eq(users.id, xUserAccountLinks.auth_user_id))
      .where(eq(xUserAccountLinks.x_user_id, xId))
      .orderBy(xUserAccountLinks.link_role, xUserAccountLinks.auth_user_id)
      .limit(1)
  )[0];
  if (!row || (!force && row.is_notification_enabled === 0)) return null;
  return row.id;
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
 * required_atomic: 本体mutationと同じD1 batchへ追加するstatementを返す。
 * payload不正やDB障害は呼び出し側へ伝播する。
 */
export async function buildNotificationOutboxStatement(
  db: AnyDb,
  input: EnqueueNotificationInput,
): Promise<NotificationOutboxStatement | null> {
  const prepared = prepareNotification(input);
  if (
    prepared.dedupeKey &&
    !input.force &&
    (await hasActiveDedupe(db, prepared.dedupeKey))
  ) {
    return null;
  }

  const recipientUserId = await resolveRecipientUserId(
    db,
    input,
    input.force ?? false,
  );
  if (!recipientUserId) return null;

  return {
    statement: insertNotificationStatement(
      db,
      buildNotificationRow(
        prepared,
        recipientUserId,
        Math.floor(Date.now() / 1000),
      ),
    ),
  };
}
