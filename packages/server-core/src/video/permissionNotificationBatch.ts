import type { notificationOutbox } from "@flamenode/db/schema";
import type { SQL } from "drizzle-orm";
import { buildPermissionNotificationBulkInsertSql } from "./permissionNotificationBulkSql.ts";

export type PermissionKnownRecipientNotificationInput = {
  recipientUserId: string;
  type: string;
  payload: Record<string, unknown>;
  deliveryRoute?: "dm" | "channel";
  correlationId?: string | null;
  eventId?: string | null;
  dedupeKey?: string | null;
};

type PayloadValidator = (
  type: string,
  payload: Record<string, unknown>,
) => { ok: boolean; reason?: string };

type PreparedNotification = {
  type: string;
  payloadJson: string;
  eventId: string | null;
  dedupeKey: string | null;
  deliveryRoute: "dm" | "channel";
  correlationId: string | null;
};

/**
 * SA-082..084 shared, unexecuted notification outbox batch.
 * The caller must supply its trusted payload validator and approved/opted-in
 * recipients; this helper does NOT perform authorization or execute any D1 SQL.
 * Append its statement to the SAME strict atomic permission mutation/audit
 * batch. Hono must use an independently verified equivalent validator.
 */
export function preparePermissionNotificationBulkBatch(
  inputs: readonly PermissionKnownRecipientNotificationInput[],
  validatePayload: PayloadValidator,
  options: { now?: number; newId?: () => string } = {},
): {
  statement: SQL | null;
  expectedChanges: null[];
  rows: Array<typeof notificationOutbox.$inferSelect>;
} {
  if (inputs.length === 0) return { statement: null, expectedChanges: [], rows: [] };
  if (inputs.length > 200) throw new Error("notification_bulk_batch_limit_exceeded");

  const preparedInputs = inputs.map((input) => {
    // The exact JSON bytes to be written must be what the validator checks.
    // Checking the original object first and serializing it again allows a
    // stateful toJSON()/getter to change its value after validation.
    let payloadJson: string | undefined;
    let serializablePayload: Record<string, unknown>;
    try {
      payloadJson = JSON.stringify(input.payload);
      if (typeof payloadJson !== "string" || !payloadJson.startsWith("{")) {
        throw new Error("not_a_json_object");
      }
      serializablePayload = JSON.parse(payloadJson) as Record<string, unknown>;
    } catch {
      throw new Error("通知 payload が不正です: JSON オブジェクトとしてシリアライズできません");
    }
    const check = validatePayload(input.type, serializablePayload);
    if (!check.ok) throw new Error(`通知 payload が不正です: ${check.reason}`);
    const prepared: PreparedNotification = {
      type: input.type,
      payloadJson,
      eventId: input.eventId ?? null,
      dedupeKey: input.dedupeKey?.trim() || null,
      deliveryRoute: input.deliveryRoute ?? (input.type === "discord_webhook" ? "channel" : "dm"),
      correlationId: typeof input.correlationId === "string" && input.correlationId.trim()
        ? input.correlationId.trim().slice(0, 160)
        : null,
    };
    return { input, prepared };
  });
  const nonNullKeys = preparedInputs
    .map(({ prepared }) => prepared.dedupeKey)
    .filter((key): key is string => key !== null);
  if (new Set(nonNullKeys).size !== nonNullKeys.length) {
    throw new Error("notification_batch_duplicate_dedupe_key");
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const newId = options.newId ?? (() => crypto.randomUUID());
  const rows = preparedInputs.map(({ input, prepared }): typeof notificationOutbox.$inferSelect => {
    const recipientUserId = input.recipientUserId.trim();
    if (!recipientUserId) throw new Error("notification_recipient_required");
    // A revoke -> re-grant is a new transition; old sent dedupe keys must not
    // swallow the new grant. Inspect duplicates BEFORE scoping the key.
    const scopedKey = prepared.type === "video_edit_permission_granted" && prepared.dedupeKey
      ? `${prepared.dedupeKey}:transition:${newId()}`
      : prepared.dedupeKey;
    return {
      id: newId(),
      recipient_user_id: recipientUserId,
      type: prepared.type,
      payload_json: prepared.payloadJson,
      delivery_route: prepared.deliveryRoute,
      correlation_id: prepared.correlationId,
      status: "pending",
      attempt_count: 0,
      processing_started_at: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      last_error: null,
      processed_at: null,
      event_id: prepared.eventId,
      dedupe_key: scopedKey,
      created_at: now,
    };
  });
  return {
    statement: buildPermissionNotificationBulkInsertSql(rows),
    expectedChanges: [null],
    rows,
  };
}
