import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(
  fileURLToPath(
    new URL("../../../../migrations/0001_spreadsheet_import_runs.sql", import.meta.url),
  ),
  "utf8",
);

const baseRun = {
  nonce: "11111111-1111-4111-8111-111111111111",
  operator: "user-1",
  table: "events",
  mode: "upsert",
  payloadHash: "a".repeat(64),
  schemaHash: "b".repeat(64),
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_300,
};

function setup(run = baseRun) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(["CREATE", 'TABLE "user" ("id" text PRIMARY KEY NOT NULL)'].join(" "));
  db.exec(["CREATE", 'TABLE "target" ("id" text PRIMARY KEY NOT NULL)'].join(" "));
  db.exec(migration);
  db.prepare('INSERT INTO "user" ("id") VALUES (?)').run(run.operator);
  db.prepare(
    `INSERT INTO spreadsheet_import_runs
      (nonce, operator_user_id, table_name, mode, payload_hash,
       schema_fingerprint, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    run.nonce,
    run.operator,
    run.table,
    run.mode,
    run.payloadHash,
    run.schemaHash,
    run.expiresAt,
    run.issuedAt,
  );
  return db;
}

function consumeAndMutate(db, expected, now, { failMutation = false } = {}) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(
      `UPDATE spreadsheet_import_runs
       SET consumed_at = ?
       WHERE nonce = ?
         AND operator_user_id = ?
         AND table_name = ?
         AND mode = ?
         AND payload_hash = ?
         AND schema_fingerprint = ?
         AND expires_at = ?
         AND created_at = ?
         AND consumed_at IS NULL
         AND expires_at >= ?`,
    ).run(
      now,
      expected.nonce,
      expected.operator,
      expected.table,
      expected.mode,
      expected.payloadHash,
      expected.schemaHash,
      expected.expiresAt,
      expected.issuedAt,
      now,
    );
    if (result.changes !== 1) throw new Error("preview_required");
    db.prepare('INSERT INTO "target" ("id") VALUES (?)').run("row-1");
    if (failMutation) throw new Error("simulated mutation failure");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("SQLite preview run is consumed with the body mutation exactly once", () => {
  const db = setup();
  consumeAndMutate(db, baseRun, baseRun.issuedAt + 1);
  assert.equal(
    db.prepare("SELECT consumed_at FROM spreadsheet_import_runs").get().consumed_at,
    baseRun.issuedAt + 1,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM target").get().count, 1);
  assert.throws(
    () => consumeAndMutate(db, baseRun, baseRun.issuedAt + 2),
    /preview_required/,
  );
});

test("SQLite preview run rejects expiry and bound claim changes", () => {
  for (const [expected, now] of [
    [baseRun, baseRun.expiresAt + 1],
    [{ ...baseRun, operator: "user-2" }, baseRun.issuedAt + 1],
    [{ ...baseRun, table: "videos" }, baseRun.issuedAt + 1],
    [{ ...baseRun, mode: "insert" }, baseRun.issuedAt + 1],
    [{ ...baseRun, payloadHash: "c".repeat(64) }, baseRun.issuedAt + 1],
    [{ ...baseRun, schemaHash: "d".repeat(64) }, baseRun.issuedAt + 1],
  ]) {
    const db = setup();
    assert.throws(() => consumeAndMutate(db, expected, now), /preview_required/);
    assert.equal(
      db.prepare("SELECT consumed_at FROM spreadsheet_import_runs").get().consumed_at,
      null,
    );
  }
});

test("SQLite body mutation failure rolls preview consumption back", () => {
  const db = setup();
  assert.throws(
    () => consumeAndMutate(db, baseRun, baseRun.issuedAt + 1, { failMutation: true }),
    /simulated mutation failure/,
  );
  assert.equal(
    db.prepare("SELECT consumed_at FROM spreadsheet_import_runs").get().consumed_at,
    null,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM target").get().count, 0);
});

test("ephemeral preview runs do not block operator deletion", () => {
  const db = setup();
  db.prepare('DELETE FROM "user" WHERE "id" = ?').run(baseRun.operator);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM spreadsheet_import_runs").get().count,
    0,
  );
});
