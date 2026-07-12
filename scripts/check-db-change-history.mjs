#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "migrations");
const active = fs.readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name).sort();
const changeLogPath = path.join(root, "docs", "database", "change-log.md");
const errors = [];
const headers = ["-- Migration:", "-- Date:", "-- Type:", "-- Summary:", "-- Data loss:", "-- Rollback:", "-- Change log:"];

if (!fs.existsSync(changeLogPath)) errors.push("docs/database/change-log.md がありません。");
else {
  const changeLog = fs.readFileSync(changeLogPath, "utf8");
  for (const migration of active) {
    const body = fs.readFileSync(path.join(migrationsDir, migration), "utf8");
    for (const header of headers) if (!new RegExp(`^${header}\\s*\\S+`, "m").test(body)) errors.push(`${migration}: header ${header} がありません。`);
    if (!changeLog.includes(migration)) errors.push(`${migration}: change logに対応項目がありません。`);
    const detail = path.join(root, "docs", "db-history", migration.replace(/\.sql$/, ".md"));
    if (!fs.existsSync(detail)) errors.push(`${migration}: ${path.relative(root, detail)} がありません。`);
    else if (!/Status:\s*Active/i.test(fs.readFileSync(detail, "utf8"))) errors.push(`${migration}: DB履歴文書がActiveではありません。`);
  }
}

const historical = path.join(migrationsDir, "historical");
const historicalSql = fs.existsSync(historical) ? fs.readdirSync(historical, { recursive: true }).filter((item) => String(item).endsWith(".sql")) : [];
if (historicalSql.length === 0) errors.push("旧migrationを保持する migrations/historical が空です。");
const historicalReadme = path.join(root, "docs", "historical", "README.md");
if (!fs.existsSync(historicalReadme) || !/Status:\s*Historical/i.test(fs.readFileSync(historicalReadme, "utf8"))) errors.push("docs/historical/README.md はHistoricalとして明示してください。");

if (errors.length) { for (const error of errors) console.error(`[check:db-history] ${error}`); process.exit(1); }
console.log("[check:db-history] OK: active migration metadata, change log, detail docs, and Historical boundary are valid.");
