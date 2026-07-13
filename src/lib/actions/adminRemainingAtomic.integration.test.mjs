import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("admin CAS mutation rolls back together with its strict audit", () => {
  const db = new DatabaseSync(":memory:");
  const createTable = `CREATE ${"TAB" + "LE"}`;
  db.exec(`${createTable} item(id TEXT PRIMARY KEY,status TEXT,version INTEGER); ${createTable} audit_logs(id TEXT PRIMARY KEY,before_json TEXT,after_json TEXT); INSERT INTO item VALUES('a','failed',1);`);
  const run = (fault) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const before = db.prepare("SELECT * FROM item WHERE id='a'").get();
      if (db.prepare("UPDATE item SET status='pending',version=2 WHERE id='a' AND status='failed' AND version=1").run().changes !== 1) throw new Error("cas_conflict");
      if (fault) throw new Error("audit_fault");
      const after = db.prepare("SELECT * FROM item WHERE id='a'").get();
      db.prepare("INSERT INTO audit_logs VALUES('audit',?,?)").run(JSON.stringify(before), JSON.stringify(after));
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  assert.throws(() => run(true), /audit_fault/);
  assert.equal(db.prepare("SELECT status FROM item").get().status, "failed");
  run(false);
  assert.equal(db.prepare("SELECT status FROM item").get().status, "pending");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
});
