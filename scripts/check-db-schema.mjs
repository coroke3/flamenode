#!/usr/bin/env node
/** Active migration列とschema.tsの同期をNode 20で検証する。 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "migrations");
const BASELINE_NAME = "0000_flame_node_baseline.sql";
const BASELINE = path.join(MIGRATIONS, BASELINE_NAME);
const SCHEMA = path.join(ROOT, "src", "lib", "db", "schema.ts");
const VERSION = "2026-07-11-baseline-1";

function fail(message) {
  console.error(`[check:db-schema] ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(BASELINE)) {
  fail(`active baseline migrations/${BASELINE_NAME} がありません。`);
} else {
  const activeFiles = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  if (
    activeFiles[0] !== BASELINE_NAME ||
    activeFiles.some((name) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  ) {
    fail(
      `active migrationは0000 baselineから番号順で配置してください: ${activeFiles.join(", ") || "なし"}`,
    );
  }

  const baselineSql = fs.readFileSync(BASELINE, "utf8");
  const activeSql = activeFiles
    .map((name) => fs.readFileSync(path.join(MIGRATIONS, name), "utf8"))
    .join("\n");
  if (!baselineSql.includes(`VALUES ('current', '${VERSION}', unixepoch())`)) {
    fail(`schema meta version ${VERSION} がbaselineにありません。`);
  }
  if (/\b(?:ALTER|DROP)\s+TABLE\b/i.test(baselineSql)) {
    fail("baselineにALTER/DROP TABLEを含めないでください。最終schemaのCREATEだけを置きます。");
  }

  const schemaText = fs.readFileSync(SCHEMA, "utf8");
  const tableNames = [
    ...schemaText.matchAll(/sqliteTable\("([a-zA-Z0-9_]+)"/g),
  ].map((match) => match[1]);
  for (const tableName of tableNames) {
    if (!activeSql.includes(`CREATE TABLE "${tableName}"`)) {
      fail(`schema.tsのtable ${tableName} がactive migration列にありません。`);
    }
  }
  for (const required of [
    'CREATE INDEX "event_staff_event_preset_idx"',
    'CREATE UNIQUE INDEX "event_staff_event_user_uniq"',
    'CREATE TABLE "worker_leases"',
    'CREATE TABLE "static_artifacts"',
    'CREATE TABLE "flamenode_schema_meta"',
    'CREATE TABLE "spreadsheet_import_runs"',
  ]) {
    if (!activeSql.includes(required)) {
      fail(`必須定義がactive migration列にありません: ${required}`);
    }
  }
}

if (!fs.existsSync(path.join(MIGRATIONS, "historical"))) {
  fail("旧migrationを保存するmigrations/historicalがありません。");
}

if (process.exitCode) process.exit(process.exitCode);
console.log("[check:db-schema] OK: active migrations and schema.ts are aligned.");
