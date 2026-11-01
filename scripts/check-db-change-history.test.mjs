import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("./check-db-change-history.mjs", import.meta.url));
const migrationName = "0001_example.sql";

function writeFixtureFile(root, file, content) {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message || args.join(" "));
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "flamenode-db-history-base-"));
  const sql = [
    "-- Migration: " + migrationName,
    "-- Date: 2026-10-31",
    "-- Type: additive",
    "-- Summary: Create an isolated example table for history verification",
    "-- Data loss: none",
    "-- Rollback: Drop the example table",
    "-- Change log: docs/database/change-log.md",
    "CREATE TABLE example (id INTEGER PRIMARY KEY);",
    "",
  ].join("\n");

  writeFixtureFile(root, "migrations/" + migrationName, sql);
  writeFixtureFile(root, "migrations/historical/0000_previous.sql", "-- historical\n");
  writeFixtureFile(root, "docs/database/change-log.md", "# Changes\n" + migrationName + "\n");
  writeFixtureFile(root, "docs/db-history/0001_example.md", [
    "> Status: Active",
    "# " + migrationName,
    "## 目的",
    "Example",
    "## 変更内容",
    "Example",
    "## データ損失",
    "None",
    "## ロールバック",
    "Drop example",
    "## 検証",
    "Check the fixture",
    "",
  ].join("\n"));
  writeFixtureFile(root, "docs/historical/README.md", "> Status: Historical\n");

  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "-c", "user.name=Migration Test", "-c", "user.email=migration-test@example.invalid", "commit", "-qm", "fixture");
  return { root, sqlPath: path.join(root, "migrations", migrationName) };
}

function runCheck(root, baseRef) {
  const env = { ...process.env };
  delete env.DB_HISTORY_BASE_REF;
  if (baseRef !== undefined) env.DB_HISTORY_BASE_REF = baseRef;
  return spawnSync(process.execPath, [checker], { cwd: root, env, encoding: "utf8" });
}

test("unknown explicit DB_HISTORY_BASE_REF fails closed instead of skipping SQL comparison", () => {
  const { root } = createFixture();
  try {
    const result = runCheck(root, "refs/heads/missing-history-baseline");
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /DB_HISTORY_BASE_REF: 指定したcommitを解決できません/);
    assert.doesNotMatch(result.stdout, /OK: /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("valid explicit HEAD compares applied migrations and rejects changes", () => {
  const { root, sqlPath } = createFixture();
  try {
    const initial = runCheck(root, "HEAD");
    assert.equal(initial.status, 0, initial.stderr);
    writeFileSync(sqlPath, readFileSync(sqlPath, "utf8") + "-- edited after application\n");
    const result = runCheck(root, "HEAD");
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /適用済みのactive migrationは変更できません/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing implicit origin/main remains supported for local checkouts", () => {
  const { root } = createFixture();
  try {
    const result = runCheck(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK: 1 active migrations validated/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
