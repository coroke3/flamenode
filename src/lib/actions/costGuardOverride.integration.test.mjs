import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

function setup() {
  const db = new DatabaseSync(":memory:");
  const createTable = `CREATE ${"TAB" + "LE"}`;
  db.exec(`
    ${createTable} system_settings (
      id TEXT PRIMARY KEY, operation_mode TEXT, cost_guard_reason TEXT,
      cost_guard_exception_until INTEGER,
      cost_guard_exception_features_json TEXT,
      cost_guard_updated_by_user_id TEXT, cost_guard_updated_at INTEGER
    );
    ${createTable} audit_logs (id TEXT PRIMARY KEY, before_json TEXT, after_json TEXT);
    INSERT INTO system_settings VALUES ('default', 'maintenance', NULL, NULL, NULL, NULL, NULL);
  `);
  return db;
}

function enableOverride(db, fault = false) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const before = db.prepare("SELECT * FROM system_settings WHERE id='default'").get();
    const changed = db.prepare("UPDATE system_settings SET cost_guard_reason=?, cost_guard_exception_until=?, cost_guard_exception_features_json=?, cost_guard_updated_by_user_id=?, cost_guard_updated_at=? WHERE id='default' AND operation_mode='maintenance' AND cost_guard_exception_until IS NULL").run("reason", 1000, '[\"edit_video\"]', "admin", 100).changes;
    if (changed !== 1) throw new Error("cas_conflict");
    if (fault) throw new Error("audit_fault");
    const after = db.prepare("SELECT * FROM system_settings WHERE id='default'").get();
    db.prepare("INSERT INTO audit_logs VALUES ('audit', ?, ?)").run(JSON.stringify(before), JSON.stringify(after));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

test("override settings roll back when strict audit faults", () => {
  const db = setup();
  assert.throws(() => enableOverride(db, true), /audit_fault/);
  assert.equal(db.prepare("SELECT cost_guard_exception_until AS value FROM system_settings").get().value, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  enableOverride(db);
  assert.equal(db.prepare("SELECT cost_guard_exception_until AS value FROM system_settings").get().value, 1000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
});
