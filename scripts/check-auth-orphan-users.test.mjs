#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { resolveDatabasePath } from "./check-event-owners.mjs";

const root = process.cwd();
const sqlPath = path.join(root, "scripts/sql/check-auth-orphan-users.sql");
const scriptPath = path.join(root, "scripts/check-auth-orphan-users.mjs");

test("orphan-users SQL file exists and references discord account join", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /FROM "user" AS u/);
  assert.match(sql, /LEFT JOIN account AS a/);
  assert.match(sql, /provider = 'discord'/);
  assert.match(sql, /WHERE a\.userId IS NULL/);
});

test("orphan-users script resolves explicit database path", () => {
  const explicit = path.join(root, "scripts/sql/check-auth-orphan-users.sql");
  assert.equal(resolveDatabasePath({ explicit }), explicit);
});

test("orphan-users script supports remote inspection via wrangler", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /--remote/);
  assert.match(source, /assertRemoteD1Configured/);
  assert.match(source, /runRemoteD1File/);
  assert.doesNotMatch(source, /execSync\s*\(/);
  assert.match(source, /wrangler d1 execute/);
  assert.match(source, /flamenode_db/);
  assert.doesNotMatch(source, /--remote is not supported/);
  assert.match(source, /process\.exit\(0\)/);
});


test("remote orphan audit handles shell metacharacters without invoking a shell or live D1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode orphan;safe-"));
  const sqlDir = path.join(dir, "scripts/sql");
  const wranglerDir = path.join(dir, "node_modules/wrangler/bin");
  const capture = path.join(dir, "wrangler-argv.json");
  try {
    fs.mkdirSync(sqlDir, { recursive: true });
    fs.mkdirSync(wranglerDir, { recursive: true });
    fs.writeFileSync(
      path.join(sqlDir, "check-auth-orphan-users.sql"),
      "SELECT id FROM user WHERE 1 = 0;\n",
    );
    fs.writeFileSync(
      path.join(wranglerDir, "wrangler.js"),
      [
        'const fs = require("node:fs");',
        'fs.writeFileSync(process.env.FLAMENODE_TEST_WRANGLER_ARGS_FILE, JSON.stringify(process.argv.slice(2)));',
        'process.stdout.write(JSON.stringify([{ results: [{ id: "orphan-1" }] }]));',
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(dir, "wrangler.toml"),
      'database_id = "11111111-1111-4111-8111-111111111111"\n',
    );
    const env = {
      ...process.env,
      FLAMENODE_D1_DATABASE_ID: "",
      CLOUDFLARE_D1_DATABASE_ID: "",
      FLAMENODE_TEST_WRANGLER_ARGS_FILE: capture,
    };
    const output = execFileSync(process.execPath, [scriptPath, "--remote"], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
    assert.match(output, /count=1/);
    assert.match(output, /orphan-1/);
    const args = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.deepEqual(args.slice(0, 6), [
      "d1", "execute", "flamenode_db", "--remote", "--json", "--command",
    ]);
    assert.match(args[6], /SELECT id FROM user WHERE 1 = 0;/);

    // A placeholder ID must fail closed before even executing the stub CLI.
    fs.rmSync(capture);
    fs.writeFileSync(
      path.join(dir, "wrangler.toml"),
      'database_id = "00000000-0000-0000-0000-000000000000"\n',
    );
    const rejected = spawnSync(process.execPath, [scriptPath, "--remote"], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
    assert.equal(rejected.status, 2, rejected.stderr);
    assert.match(rejected.stderr, /placeholder/);
    assert.equal(fs.existsSync(capture), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
