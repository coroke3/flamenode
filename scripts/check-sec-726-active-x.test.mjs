import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { normalizeRemoteD1Sql } from "./remote-d1-utils.mjs";

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
  fixture(({ db }) => {
    db.prepare('INSERT INTO "user" (active_x_user_id) VALUES (?)').run("selected");
    for (const query of [sql, normalizeRemoteD1Sql(sql)]) {
      assert.deepEqual({ ...db.prepare(query).get() }, { unsafe_selected_legacy_ids: 0 },
        "local and whitespace-normalized remote SQL both execute as one aggregate");
    }
  });
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

test("SEC-726 counts decoded UTF-8 limits without rejecting admissible replacement sequences", () => {
  // CAST preserves malformed bytes as TEXT, as in legacy D1 rows. Buffer's UTF-8
  // decoder retains BOMs and groups incomplete valid prefixes like D1 does.
  const cases = [
    ["surrogate prefix below limit", "eda080".repeat(42), 126, false],
    ["surrogate prefix at limit", "eda080".repeat(42) + "6161", 128, false],
    ["surrogate prefix over limit", "eda080".repeat(43), 129, true],
    ["overlong prefix at limit", "c080".repeat(64), 128, false],
    ["overlong prefix over limit", "c080".repeat(65), 130, true],
    ["out-of-range prefix at limit", "f4908080".repeat(32), 128, false],
    ["out-of-range prefix over limit", "f4908080".repeat(33), 132, true],
    ["out-of-range prefix at raw byte limit", "f4908080".repeat(128), 512, true],
    ["incomplete three-byte prefixes", "e180".repeat(128), 128, false],
    ["incomplete four-byte prefixes", "f19080".repeat(128), 128, false],
    ["incomplete two-byte prefixes", "c2".repeat(128), 128, false],
    ["continuation bytes at limit", "80".repeat(128), 128, false],
    ["invalid third byte reprocessed", "e18041".repeat(64), 128, false],
    ["invalid fourth byte reprocessed", "f1908041".repeat(64), 128, false],
    ["BOM retained at limit", "efbbbf" + "eda080".repeat(42) + "61", 128, false],
    ["BOM retained over limit", "efbbbf" + "eda080".repeat(42) + "6161", 129, true],
    ["literal replacement characters", "efbfbd".repeat(128), 128, false],
    ["valid four-byte scalars", "f09f8c80".repeat(128), 128, false],
    ["highest Unicode scalars", "f48fbfbf".repeat(128), 128, false],
  ];
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  fixture(({ db, dbPath }) => {
    const add = db.prepare('INSERT INTO "user" (active_x_user_id) VALUES (CAST(? AS TEXT))');
    const queries = [sql, normalizeRemoteD1Sql(sql)].map(query => db.prepare(query));
    const rawLength = db.prepare('SELECT length(active_x_user_id) AS n FROM "user"');
    for (const [label, hex, decodedPoints, unsafe] of cases) {
      const bytes = Buffer.from(hex, "hex");
      assert.equal([...bytes.toString("utf8")].length, decodedPoints, label);
      assert.ok(bytes.length <= 512, label);
      add.run(bytes);
      assert.ok(rawLength.get().n <= 128, `${label}: raw storage guard passes`);
      for (const query of queries) {
        assert.deepEqual({ ...query.get() }, { unsafe_selected_legacy_ids: Number(unsafe) }, label);
      }
      db.exec('DELETE FROM "user"');
    }
    for (const [, hex] of cases) add.run(Buffer.from(hex, "hex"));
    // Duplicate unsafe rows must each contribute to the aggregate.
    add.run(Buffer.from("eda080".repeat(43), "hex"));
    add.run(Buffer.from("eda080".repeat(43), "hex"));
    const count = cases.filter(([, , , unsafe]) => unsafe).length + 2;
    const r = check("--database=" + dbPath);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, new RegExp(`unsafe_selected_legacy_ids=${count}\\b`));
    assert.match(r.stderr, /\bBLOCKED\b/);
    assert.doesNotMatch(r.stdout + r.stderr, /\uFFFD|\uFEFF|🌀/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "user"').get().n, cases.length + 2,
      "inspection preserves every stored row");
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
    // A poisoned working-directory SQL must not replace the reviewed script-local query.
    fs.writeFileSync(path.join(dir, "scripts/sql/check-sec-726-active-x.sql"),
      'DELETE FROM "user";\n');
    fs.mkdirSync(path.join(dir, "node_modules/wrangler/bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules/wrangler/bin/wrangler.js"), [
      'const fs = require("node:fs");',
      'fs.writeFileSync(process.env.SEC726_CAPTURE, JSON.stringify(process.argv.slice(2)));',
      'const count = process.env.SEC726_MALFORMED === "1" ? "  " : 0;',
      'process.stdout.write(JSON.stringify([{results:[{unsafe_selected_legacy_ids:count}]}]));',
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
    // Malformed aggregate output ("  ") must not silently coerce to zero.
    const malformed = spawnSync(process.execPath, [SCRIPT, "--remote"], {
      cwd: dir, env: { ...env, SEC726_MALFORMED: "1" }, encoding: "utf8",
    });
    assert.equal(malformed.status, 2);
    assert.match(malformed.stderr, /BLOCKED/);
    assert.doesNotMatch(malformed.stdout, /unsafe_selected_legacy_ids=0/);
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
