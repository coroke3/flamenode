#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
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
  assert.match(source, /wrangler d1 execute/);
  assert.match(source, /flamenode_db/);
  assert.doesNotMatch(source, /--remote is not supported/);
  assert.match(source, /process\.exit\(0\)/);
});
