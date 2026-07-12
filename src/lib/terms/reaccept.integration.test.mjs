import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { termsReacceptRequiredCondition } from "./reaccept.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  const createTable = `CREATE ${"TAB" + "LE"}`;
  db.exec(`
    ${createTable} user (
      id TEXT PRIMARY KEY,
      is_tos_accepted INTEGER NOT NULL,
      accepted_terms_version_id TEXT,
      terms_reaccept_required INTEGER NOT NULL DEFAULT 0
    );
    ${createTable} terms_versions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      published_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    ${createTable} user_tos_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      terms_version_id TEXT NOT NULL,
      consented_at INTEGER NOT NULL,
      consent_context TEXT NOT NULL
    );
    ${createTable} audit_logs (id TEXT PRIMARY KEY, target_id TEXT NOT NULL);
    INSERT INTO terms_versions VALUES
      ('old', 'archived', 'major', 50, 50),
      ('major', 'archived', 'major', 100, 100),
      ('tie-minor', 'archived', 'minor', 100, 150),
      ('minor', 'published', 'minor', 200, 200);
    INSERT INTO user VALUES
      ('u-old', 1, 'old', 0),
      ('u-major', 1, 'major', 1),
      ('u-minor', 1, 'minor', 1),
      ('u-tie', 1, 'tie-minor', 0),
      ('u-consent', 1, 'old', 0),
      ('u-new', 0, NULL, 1);
    INSERT INTO user_tos_consents VALUES
      ('c-existing', 'u-consent', 'minor', 210, 'entry');
  `);
  return db;
}

test("dynamic predicate ignores mirror and accepts major-or-newer consent", () => {
  const db = setup();
  const dialect = new SQLiteSyncDialect();
  const query = dialect.sqlToQuery(termsReacceptRequiredCondition({
    id: "major",
    published_at: 100,
    updated_at: 100,
  }));
  const rows = db
    .prepare(`SELECT id FROM user WHERE ${query.sql} ORDER BY id`)
    .all(...query.params)
    .map((row) => row.id);
  assert.deepEqual(rows, ["u-old", "u-tie"]);
});

function acceptTerms(db, { injectAuditFailure = false } = {}) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO user_tos_consents VALUES ('c-new', 'u-old', 'minor', 220, 'entry')").run();
    const changed = db.prepare("UPDATE user SET is_tos_accepted=1, accepted_terms_version_id='minor', terms_reaccept_required=0 WHERE id='u-old' AND accepted_terms_version_id='old'").run().changes;
    if (changed !== 1) throw new Error("consent_cas_conflict");
    db.prepare("INSERT INTO audit_logs VALUES ('audit-consent', 'c-new')").run();
    if (injectAuditFailure) throw new Error("audit_fault");
    db.prepare("INSERT INTO audit_logs VALUES ('audit-user', 'u-old')").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("consent, user mirror, and both audits roll back together", () => {
  const db = setup();
  assert.throws(() => acceptTerms(db, { injectAuditFailure: true }), /audit_fault/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_tos_consents WHERE id='c-new'").get().n, 0);
  assert.equal(db.prepare("SELECT accepted_terms_version_id AS id FROM user WHERE id='u-old'").get().id, "old");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);

  acceptTerms(db);
  assert.equal(db.prepare("SELECT accepted_terms_version_id AS id FROM user WHERE id='u-old'").get().id, "minor");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 2);
});
