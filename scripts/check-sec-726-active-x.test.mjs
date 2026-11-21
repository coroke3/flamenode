import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts/check-sec-726-active-x.mjs");
const SQL_PATH = path.join(ROOT, "scripts/sql/check-sec-726-active-x.sql");

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec726-d1;read-only-"));
  const dbPath = path.join(dir, "identity.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE "user" (active_x_user_id TEXT)');
    run({ db, dbPath, dir });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function check(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT, encoding: "utf8",
  });
}

test("SEC-726 SQL exactly counts the SEC-713 persisted-session guard failures without selecting identifiers", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  assert.match(sql, /^SELECT COUNT\(\*\) AS unsafe_selected_legacy_ids\s+FROM "user"/i);
  assert.match(sql, /active_x_user_id IS NOT NULL/);
  assert.match(sql, /typeof\(active_x_user_id\) <> 'text'/);
  assert.match(sql, /instr\(active_x_user_id, char\(0\)\) > 0/);
  assert.match(sql, /length\(active_x_user_id\) > 128/);
  assert.match(sql, /length\(CAST\(active_x_user_id AS BLOB\)\) > 512/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|REPLACE|PRAGMA|ATTACH)\b/i);
  assert.equal((sql.match(/;/g) ?? []).length, 1, "single read-only aggregate statement");
});

test("SEC-726 local preflight accepts NULL, empty TEXT and both 128-codepoint Unicode limits", () => {
  fixture(({ db, dbPath }) => {
    const add = db.prepare('INSERT INTO "user" (active_x_user_id) VALUES (?)');
    for (const x of [null, "", "a".repeat(128), "あ".repeat(128), "🌀".repeat(128)]) add.run(x);
    const r = check("--database=" + dbPath);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /unsafe_selected_legacy_ids=0/);
    assert.match(r.stdout, /\bPASS\b/);
    assert.doesNotMatch(r.stdout + r.stderr, /🌀|あ/);
  });
});

test("SEC-726 local preflight blocks oversized, NUL and BLOB selections without logging PII", () => {
  fixture(({ db, dbPath }) => {
    const add = db.prepare('INSERT INTO "user" (active_x_user_id) VALUES (?)');
    for (const x of ["x".repeat(129), "あ".repeat(129), "🌀".repeat(129),
                     "safe\0hidden", new Uint8Array([1, 2, 3])]) add.run(x);
    const r = check("--database=" + dbPath);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /unsafe_selected_legacy_ids=5/);
    assert.match(r.stderr, /\bBLOCKED\b/);
    assert.doesNotMatch(r.stdout + r.stderr, /hidden|🌀|あ|safe\x00/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "user"').get().n, 5,
      "read-only inspection never modifies legacy data");
  });
});

test("SEC-726 local preflight fails closed for no path, missing file or missing table", () => {
  assert.equal(check().status, 2, "no implicit local/remote target");
  assert.equal(check("--database=/does-not-exist/sec726.db").status, 2);
  fixture(({ db, dbPath }) => {
    db.exec('DROP TABLE "user"');
    const r = check("--database=" + dbPath);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /BLOCKED/);
  });
});

test("SEC-726 explicit remote read-only path uses argument-vector Wrangler and aggregate-only output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec726-remote;quoted-"));
  const capture = path.join(dir, "args.json");
  try {
    fs.mkdirSync(path.join(dir, "scripts/sql"), { recursive: true });
    fs.copyFileSync(SQL_PATH, path.join(dir, "scripts/sql/check-sec-726-active-x.sql"));
    fs.mkdirSync(path.join(dir, "node_modules/wrangler/bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules/wrangler/bin/wrangler.js"), [
      'const fs = require("node:fs");',
      'fs.writeFileSync(process.env.SEC726_CAPTURE, JSON.stringify(process.argv.slice(2)));',
      'process.stdout.write(JSON.stringify([{results:[{unsafe_selected_legacy_ids:0}]}]));',
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "wrangler.toml"),
      'database_id = "11111111-1111-4111-8111-111111111111"\n');
    const env = {
      ...process.env, SEC726_CAPTURE: capture,
      FLAMENODE_D1_DATABASE_ID: "", CLOUDFLARE_D1_DATABASE_ID: "",
    };
    const result = spawnSync(process.execPath, [SCRIPT, "--remote"], {
      cwd: dir, env, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /unsafe_selected_legacy_ids=0/);
    const args = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.deepEqual(args.slice(0, 6),
      ["d1", "execute", "flamenode_db", "--remote", "--json", "--command"]);
    assert.match(args[6], /^SELECT COUNT\(\*\) AS unsafe_selected_legacy_ids/);
    assert.doesNotMatch(args[6], /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|PRAGMA)\b/i);
    fs.rmSync(capture);
    fs.writeFileSync(path.join(dir, "wrangler.toml"),
      'database_id = "00000000-0000-0000-0000-000000000000"\n');
    const noTarget = spawnSync(process.execPath, [SCRIPT, "--remote"], {
      cwd: dir, env, encoding: "utf8",
    });
    assert.equal(noTarget.status, 2);
    assert.equal(fs.existsSync(capture), false, "placeholder prevents remote invocation");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
