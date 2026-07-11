#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "migrations");
const active = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();
const changeLogPath = path.join(root, "docs", "database", "change-log.md");
const errors = [];

if (!fs.existsSync(changeLogPath)) {
  errors.push("docs/database/change-log.md がありません。");
} else {
  const changeLog = fs.readFileSync(changeLogPath, "utf8");
  for (const migration of active) {
    const body = fs.readFileSync(path.join(migrationsDir, migration), "utf8");
    for (const header of ["-- Migration:", "-- Date:", "-- Type:", "-- Summary:", "-- Data loss:", "-- Rollback:", "-- Change log:"]) {
      if (!body.includes(header)) errors.push(`${migration}: header ${header} がありません。`);
    }
    if (!changeLog.includes(migration)) errors.push(`${migration}: change logに対応項目がありません。`);
  }
}

const historical = path.join(migrationsDir, "historical");
if (!fs.existsSync(historical) || fs.readdirSync(historical, { recursive: true }).filter((item) => String(item).endsWith(".sql")).length === 0) {
  errors.push("旧migrationを保持する migrations/historical が空です。");
}

if (errors.length) {
  for (const error of errors) console.error(`[check:db-history] ${error}`);
  process.exit(1);
}
console.log("[check:db-history] OK: active baseline headers and DB history are complete.");
