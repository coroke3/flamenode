#!/usr/bin/env node
/** Active baseline と schema.ts の同期を、Node 20 でも実行できる静的検査で確認する。 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "migrations");
const BASELINE = path.join(MIGRATIONS, "0000_flame_node_baseline.sql");
const SCHEMA = path.join(ROOT, "src", "lib", "db", "schema.ts");
const VERSION = "2026-07-11-baseline-1";

function fail(message) {
  console.error(`[check:db-schema] ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(BASELINE)) {
  fail("active baseline migrations/0000_flame_node_baseline.sql がありません。");
} else {
  const activeSql = fs.readFileSync(BASELINE, "utf8");
  const activeFiles = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  if (activeFiles.length !== 1 || activeFiles[0] !== "0000_flame_node_baseline.sql") {
    fail(`active migrationはbaseline一つだけでなければなりません: ${activeFiles.join(", ") || "なし"}`);
  }
  if (!activeSql.includes(`VALUES ('current', '${VERSION}', unixepoch())`)) {
    fail(`schema meta version ${VERSION} がbaselineにありません。`);
  }
  if (/\b(?:ALTER|DROP)\s+TABLE\b/i.test(activeSql)) {
    fail("baselineにALTER/DROP TABLEを含めないでください。最終schemaのCREATEだけを置きます。");
  }

  const schemaText = fs.readFileSync(SCHEMA, "utf8");
  const tableNames = [...schemaText.matchAll(/sqliteTable\("([a-zA-Z0-9_]+)"/g)].map((match) => match[1]);
  for (const tableName of tableNames) {
    if (!activeSql.includes(`CREATE TABLE "${tableName}"`)) {
      fail(`schema.tsのtable ${tableName} がactive baselineにありません。`);
    }
  }
  for (const required of [
    'CREATE INDEX "event_staff_event_preset_idx"',
    'CREATE UNIQUE INDEX "event_staff_event_user_uniq"',
    'CREATE TABLE "worker_leases"',
    'CREATE TABLE "static_artifacts"',
    'CREATE TABLE "flamenode_schema_meta"',
  ]) {
    if (!activeSql.includes(required)) fail(`必須定義がbaselineにありません: ${required}`);
  }
}

if (!fs.existsSync(path.join(MIGRATIONS, "historical"))) {
  fail("旧migrationを保存する migrations/historical がありません。");
}

if (process.exitCode) process.exit(process.exitCode);
console.log("[check:db-schema] OK: active baseline and schema.ts are aligned.");
