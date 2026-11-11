import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildPermissionNotificationBulkInsertSql } from "../src/video/permissionNotificationBulkSql.ts";

const dialect = new SQLiteSyncDialect();
const columns = [
  "id", "recipient_user_id", "type", "payload_json", "delivery_route",
  "correlation_id", "status", "attempt_count", "processing_started_at",
  "lease_token", "lease_expires_at", "next_attempt_at", "last_error",
  "processed_at", "event_id", "dedupe_key", "created_at",
];
const notification = (id, key) => ({
  id, recipient_user_id: "u1", type: "video_edit_permission_granted",
  payload_json: JSON.stringify({ content: "付与", url: "https://example.test/dashboard/edit/v1" }),
  delivery_route: "dm", correlation_id: null, status: "pending",
  attempt_count: 0, processing_started_at: null, lease_token: null,
  lease_expires_at: null, next_attempt_at: null, last_error: null,
  processed_at: null, event_id: "event1", dedupe_key: key, created_at: 100,
});

function world() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE notification_outbox (
    id TEXT PRIMARY KEY, recipient_user_id TEXT, type TEXT, payload_json TEXT,
    delivery_route TEXT, correlation_id TEXT, status TEXT, attempt_count INTEGER,
    processing_started_at INTEGER, lease_token TEXT, lease_expires_at INTEGER,
    next_attempt_at INTEGER, last_error TEXT, processed_at INTEGER,
    event_id TEXT, dedupe_key TEXT, created_at INTEGER
  ); CREATE UNIQUE INDEX notification_active_dedupe
     ON notification_outbox(dedupe_key)
     WHERE status IN ('pending','processing','sent') AND dedupe_key IS NOT NULL;`);
  return sqlite;
}

test("SA-082..084 JSON1 notification bulk DML preserves all 17 columns, one bound JSON parameter", () => {
  const sqlite = world();
  try {
    const row = notification("n1", "permission:v1:u1:transition:t1");
    const compiled = dialect.sqlToQuery(buildPermissionNotificationBulkInsertSql([row]));
    assert.equal(compiled.params.length, 1);
    assert.deepEqual(JSON.parse(compiled.params[0]), [row]);
    assert.match(compiled.sql, /INSERT OR IGNORE INTO notification_outbox/i);
    assert.match(compiled.sql, /FROM json_each\(\?\)/i);
    const result = sqlite.prepare(compiled.sql).run(...compiled.params);
    assert.equal(result.changes, 1);
    const actual = sqlite.prepare("SELECT * FROM notification_outbox WHERE id = ?").get("n1");
    assert.deepEqual(
      Object.fromEntries(columns.map(k => [k, actual[k]])),
      Object.fromEntries(columns.map(k => [k, row[k]])),
    );
  } finally { sqlite.close(); }
});

test("SA-082..084 notification grant transition dedupe preserves re-grant, ignores active collision", () => {
  const sqlite = world();
  try {
    const rows = [
      notification("n1", "permission:v1:u1:transition:t1"),
      notification("n2", "permission:v1:u1:transition:t1"),
      notification("n3", "permission:v1:u1:transition:t2"),
    ];
    const compiled = dialect.sqlToQuery(buildPermissionNotificationBulkInsertSql(rows));
    assert.equal(sqlite.prepare(compiled.sql).run(...compiled.params).changes, 2);
    assert.deepEqual(
      sqlite.prepare("SELECT id FROM notification_outbox ORDER BY id").all().map(x => x.id),
      ["n1", "n3"],
    );
  } finally { sqlite.close(); }
});

test("SA-082..084 outbox SQL fails before mutation on invalid batch sizes", () => {
  assert.throws(() => buildPermissionNotificationBulkInsertSql([]), /rows_out_of_range/);
  assert.throws(() => buildPermissionNotificationBulkInsertSql(
    Array.from({ length: 201 }, (_, i) => notification(String(i), String(i))),
  ), /rows_out_of_range/);
});
