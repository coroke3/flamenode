import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./check-d1-bootstrap-state.mjs", import.meta.url));

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-d1-bootstrap-"));
  try { return run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function invoke(root, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, ...env },
  });
}

function createDb(root, ddl = []) {
  const file = path.join(root, "fixture.sqlite");
  const db = new DatabaseSync(file);
  try { for (const statement of ddl) db.exec(statement); }
  finally { db.close(); }
  return file;
}

test("fresh local DB without d1_migrations is empty, not initialized", () => fixture((root) => {
  const file = createDb(root);
  assert.equal(invoke(root, [`--database=${file}`, "--expect-empty"]).status, 0);
  assert.equal(invoke(root, [`--database=${file}`, "--expect-initialized"]).status, 1);
}));

test("user table without d1_migrations is neither empty nor initialized", () => fixture((root) => {
  const file = createDb(root, ["CREATE TABLE videos (id TEXT)"]);
  assert.equal(invoke(root, [`--database=${file}`, "--expect-empty"]).status, 1);
  assert.equal(invoke(root, [`--database=${file}`, "--expect-initialized"]).status, 1);
}));

test("initialized state requires both a user table and a migration row", () => fixture((root) => {
  const file = createDb(root, [
    "CREATE TABLE videos (id TEXT)",
    "CREATE TABLE d1_migrations (id INTEGER)",
    "INSERT INTO d1_migrations VALUES (1)",
  ]);
  assert.equal(invoke(root, [`--database=${file}`, "--expect-initialized"]).status, 0);
  assert.equal(invoke(root, [`--database=${file}`, "--expect-empty"]).status, 1);
}));

test("missing migration rows are not treated as initialized", () => fixture((root) => {
  const file = createDb(root, ["CREATE TABLE videos (id TEXT)", "CREATE TABLE d1_migrations (id INTEGER)"]);
  assert.equal(invoke(root, [`--database=${file}`, "--expect-initialized"]).status, 1);
}));

test("invalid local input fails closed", () => fixture((root) => {
  assert.equal(invoke(root, ["--expect-empty"]).status, 2);
  assert.equal(invoke(root, [`--database=${path.join(root, "missing.sqlite")}`, "--expect-empty"]).status, 2);
  assert.equal(invoke(root, [`--database=${root}`, "--expect-empty", "--expect-initialized"]).status, 2);
}));

test("remote empty database queries only sqlite_master, without reading a missing table", () => fixture((root) => {
  const cli = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  const log = path.join(root, "commands.jsonl");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nif (process.argv.at(-1).includes('FROM d1_migrations')) process.exit(7);\nconsole.log(JSON.stringify([{results:[{user_tables:0,has_migrations:0}]}]));\n`);
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  const result = invoke(root, ["--remote", "--expect-empty"], {FLAMENODE_D1_DATABASE_ID:"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"});
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 6), ["d1", "execute", "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "--remote", "--json", "--command"]);
}));

test("remote malformed results fail closed rather than reporting empty", () => fixture((root) => {
  const cli = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "console.log(JSON.stringify([{results:[{has_migrations:0}]}]));");
  const result = invoke(root, ["--remote", "--expect-empty"], {FLAMENODE_D1_DATABASE_ID:"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing user_tables/);
}));
