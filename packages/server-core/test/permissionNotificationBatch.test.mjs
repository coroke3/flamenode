import assert from "node:assert/strict";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { preparePermissionNotificationBulkBatch } from "../src/video/permissionNotificationBatch.ts";

const valid = (type, payload) => ({
  ok: type === "video_edit_permission_granted" &&
    payload !== null && typeof payload.content === "string" && payload.content.length <= 2000,
  reason: "invalid",
});
const input = (recipientUserId = "user-1", dedupeKey = "video:v1:user-1") => ({
  recipientUserId,
  type: "video_edit_permission_granted",
  payload: { content: "編集権限を付与しました" },
  dedupeKey,
  eventId: "ev1",
});

test("SA-084 empty batch creates no SQL and invalid/oversized batches are rejected", () => {
  assert.deepEqual(preparePermissionNotificationBulkBatch([], valid), {
    statement: null, expectedChanges: [], rows: [],
  });
  assert.throws(() => preparePermissionNotificationBulkBatch(Array.from({ length: 201 }, (_, i) => input(String(i), String(i))), valid), /notification_bulk_batch_limit_exceeded/);
  assert.throws(() => preparePermissionNotificationBulkBatch([{ ...input(), payload: { content: 3000 } }], valid), /通知 payload が不正です/);
  assert.throws(() => preparePermissionNotificationBulkBatch([{ ...input(), recipientUserId: " " }], valid), /notification_recipient_required/);
});

test("SA-084 duplicate original dedupe keys fail before transition UUIDs are generated", () => {
  let calls = 0;
  assert.throws(() => preparePermissionNotificationBulkBatch([input("a"), input("b")], valid, {
    newId: () => String(++calls),
  }), /notification_batch_duplicate_dedupe_key/);
  assert.equal(calls, 0);
});

test("SA-084 atomic bulk uses one bound JSON1 SQL, null changes and transition-scoped keys", () => {
  let i = 0;
  const result = preparePermissionNotificationBulkBatch([input("u1", "grant1"), input("u2", "grant2")], valid, {
    now: 1700000000,
    newId: () => `id-${++i}`,
  });
  assert.deepEqual(result.expectedChanges, [null]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map((r) => ({
    id: r.id, dedupe: r.dedupe_key, recipient: r.recipient_user_id, status: r.status,
    created: r.created_at, event: r.event_id, delivery: r.delivery_route,
  })), [
    { id: "id-2", dedupe: "grant1:transition:id-1", recipient: "u1", status: "pending", created: 1700000000, event: "ev1", delivery: "dm" },
    { id: "id-4", dedupe: "grant2:transition:id-3", recipient: "u2", status: "pending", created: 1700000000, event: "ev1", delivery: "dm" },
  ]);
  const query = new SQLiteSyncDialect().sqlToQuery(result.statement);
  assert.match(query.sql, /INSERT OR IGNORE INTO notification_outbox/);
  assert.match(query.sql, /FROM json_each\(/);
  assert.equal(query.sql.includes("grant1"), false);
  assert.ok(query.params.some((p) => typeof p === "string" && p.includes("grant1:transition:id-1")));
});

test("SA-084 non-grant inputs preserve dedupe, normalize correlation and channel defaults", () => {
  const generic = (type, payload) => ({ ok: !!type && payload !== null });
  const result = preparePermissionNotificationBulkBatch([{
    recipientUserId: "u1", type: "discord_webhook", payload: { content: "notice" },
    dedupeKey: " key ", correlationId: " trace ", eventId: null,
  }], generic, { now: 1700000001, newId: () => "uuid" });
  assert.equal(result.rows[0].dedupe_key, "key");
  assert.equal(result.rows[0].correlation_id, "trace");
  assert.equal(result.rows[0].delivery_route, "channel");
  assert.equal(result.rows[0].id, "uuid");
});
