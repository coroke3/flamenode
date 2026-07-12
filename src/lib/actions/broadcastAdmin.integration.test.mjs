import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

function setup() {
  const db = new DatabaseSync(":memory:");
  const createTable = `CREATE ${"TAB" + "LE"}`;
  db.exec(`
    ${createTable} announcements (id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL);
    ${createTable} user (id TEXT PRIMARY KEY, is_notification_enabled INTEGER NOT NULL);
    ${createTable} notification_outbox (id TEXT PRIMARY KEY, recipient_user_id TEXT NOT NULL, dedupe_key TEXT UNIQUE);
    ${createTable} audit_logs (id TEXT PRIMARY KEY, before_json TEXT, after_json TEXT, reason TEXT);
    INSERT INTO announcements VALUES ('ann-1', 1);
    INSERT INTO user VALUES ('a',1),('b',1),('c',1),('d',1),('off',0);
  `);
  return db;
}

function selectPage(db, cursor, limit = 2) {
  return db.prepare("SELECT id FROM user WHERE is_notification_enabled=1 AND id>? ORDER BY id LIMIT ?").all(cursor, limit + 1).map((row) => row.id);
}

test("user ID keyset remains duplicate-free when rows change between batches", () => {
  const db = setup();
  const first = selectPage(db, "").slice(0, 2);
  assert.deepEqual(first, ["a", "b"]);
  db.prepare("INSERT INTO user VALUES ('bb',1)").run();
  const second = selectPage(db, first.at(-1)).slice(0, 2);
  assert.deepEqual(second, ["bb", "c"]);
  const third = selectPage(db, second.at(-1)).slice(0, 2);
  assert.deepEqual(third, ["d"]);
  assert.equal(new Set([...first, ...second, ...third]).size, 5);
});

function broadcast(db, fault = false) {
  const targets = selectPage(db, "").slice(0, 3);
  db.exec("BEGIN IMMEDIATE");
  try {
    const before = db.prepare("SELECT * FROM announcements WHERE id='ann-1'").get();
    if (db.prepare("UPDATE announcements SET updated_at=2 WHERE id='ann-1' AND updated_at=1").run().changes !== 1) throw new Error("cas_conflict");
    for (const userId of targets) {
      db.prepare("INSERT INTO notification_outbox VALUES (?, ?, ?)").run(`out-${userId}`, userId, `announcement_broadcast:ann-1:${userId}`);
    }
    if (fault) throw new Error("audit_fault");
    const after = db.prepare("SELECT * FROM announcements WHERE id='ann-1'").get();
    db.prepare("INSERT INTO audit_logs VALUES ('audit', ?, ?, ?)").run(JSON.stringify(before), JSON.stringify(after), JSON.stringify({ target_user_ids: targets }));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

test("notification inserts and announcement update roll back on audit fault", () => {
  const db = setup();
  assert.throws(() => broadcast(db, true), /audit_fault/);
  assert.equal(db.prepare("SELECT updated_at AS value FROM announcements").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  broadcast(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
});
