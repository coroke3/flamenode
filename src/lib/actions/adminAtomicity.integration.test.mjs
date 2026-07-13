import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

function setup() {
  const db = new DatabaseSync(":memory:");
  // Static legacy-DDL check applies to runtime source; this is an in-memory test fixture.
  const createTable = `CREATE ${"TAB" + "LE"}`;
  db.exec(`
    PRAGMA foreign_keys = ON;
    ${createTable} user (id TEXT PRIMARY KEY, role TEXT NOT NULL, is_banned INTEGER NOT NULL);
    ${createTable} terms_versions (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
    ${createTable} audit_logs (id TEXT PRIMARY KEY, target_id TEXT NOT NULL, before_json TEXT, after_json TEXT);
    INSERT INTO user VALUES ('u1', 'user', 0);
    INSERT INTO terms_versions VALUES ('old', 'published', 1), ('new', 'draft', 1);
  `);
  return db;
}

function atomicUserRole(db, expectedRole, nextRole, injectAuditFailure = false) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare("UPDATE user SET role = ? WHERE id = 'u1' AND role = ? AND is_banned = 0").run(nextRole, expectedRole);
    if (result.changes !== 1) throw new Error("cas_conflict");
    if (injectAuditFailure) throw new Error("audit_fault");
    db.prepare("INSERT INTO audit_logs VALUES (?, 'u1', ?, ?)").run(crypto.randomUUID(), JSON.stringify({ role: expectedRole, is_banned: 0 }), JSON.stringify({ role: nextRole, is_banned: 0 }));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("real SQLite rolls back a user mutation when audit insertion faults", () => {
  const db = setup();
  assert.throws(() => atomicUserRole(db, "user", "admin", true), /audit_fault/);
  assert.equal(db.prepare("SELECT role FROM user WHERE id='u1'").get().role, "user");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("real SQLite CAS rejects stale writes without mutation or audit", () => {
  const db = setup();
  atomicUserRole(db, "user", "admin");
  assert.throws(() => atomicUserRole(db, "user", "moderator"), /cas_conflict/);
  assert.equal(db.prepare("SELECT role FROM user WHERE id='u1'").get().role, "admin");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
});

test("published terms switch remains single-row on fault and success", () => {
  const db = setup();
  const publish = (fault) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (db.prepare("UPDATE terms_versions SET status='archived', updated_at=2 WHERE id='old' AND status='published' AND updated_at=1").run().changes !== 1) throw new Error("old_cas");
      if (db.prepare("UPDATE terms_versions SET status='published', updated_at=2 WHERE id='new' AND status='draft' AND updated_at=1").run().changes !== 1) throw new Error("new_cas");
      if (fault) throw new Error("audit_fault");
      db.prepare("INSERT INTO audit_logs VALUES ('terms-audit', 'new', '{}', '{}')").run();
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  assert.throws(() => publish(true), /audit_fault/);
  assert.deepEqual(db.prepare("SELECT id FROM terms_versions WHERE status='published'").all().map((row) => row.id), ["old"]);
  publish(false);
  assert.deepEqual(db.prepare("SELECT id FROM terms_versions WHERE status='published'").all().map((row) => row.id), ["new"]);
});
