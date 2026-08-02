#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const migrationsDir = path.join(root, "migrations");
const changeLogPath = path.join(root, "docs", "database", "change-log.md");
const historyDir = path.join(root, "docs", "db-history");
const errors = [];

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const ALLOWED_TYPES = new Set([
  "additive",
  "destructive",
  "data-migration",
  "constraint",
  "cleanup",
  "baseline",
]);
const ALLOWED_DATA_LOSS = new Set(["none", "possible", "intentional"]);

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function metadataValue(body, key) {
  const match = body.match(new RegExp(`^--\\s*${key}:\\s*(.+?)\\s*$`, "mi"));
  return match?.[1]?.trim() ?? "";
}

function assertMetadata(migrationName, body, key) {
  const value = metadataValue(body, key);
  if (!value) errors.push(`${migrationName}: -- ${key}: がありません。`);
  return value;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function normalizeTrackedText(body) {
  return body.replace(/\r\n?/g, "\n").trim();
}

function checkAppliedMigrationChanges(migrationFiles) {
  // PRのbaseが統合作業ブランチでも、main未適用migrationは修正可能にする。
  // mainへ既に存在するactive migrationだけを不変として扱う。
  const explicitBase = process.env.DB_HISTORY_BASE_REF?.trim();
  const baseRef = explicitBase || "origin/main";
  if (git(["rev-parse", "--verify", baseRef]) === null) return;

  for (const migrationName of migrationFiles) {
    const baseBody = git(["show", `${baseRef}:migrations/${migrationName}`]);
    if (baseBody === null) continue;
    const currentBody = fs.readFileSync(path.join(migrationsDir, migrationName), "utf8");
    if (normalizeTrackedText(baseBody) !== normalizeTrackedText(currentBody)) {
      errors.push(
        `${migrationName}: ${baseRef}へ適用済みのactive migrationは変更できません。新しい連番migrationを追加してください。`,
      );
    }
  }
}

if (!fs.existsSync(migrationsDir)) {
  console.error("[check:db-history] migrations/ がありません。");
  process.exit(1);
}

const migrationFiles = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();

const numberOwners = new Map();
for (const migrationName of migrationFiles) {
  const match = migrationName.match(FILE_PATTERN);
  if (!match) {
    errors.push(`${migrationName}: ファイル名はNNNN_snake_case.sql形式にしてください。`);
    continue;
  }
  const number = match[1];
  const prior = numberOwners.get(number);
  if (prior) errors.push(`${migrationName}: migration番号${number}が${prior}と重複しています。`);
  else numberOwners.set(number, migrationName);
}

if (!fs.existsSync(changeLogPath)) errors.push("docs/database/change-log.md がありません。");
const changeLog = fs.existsSync(changeLogPath) ? fs.readFileSync(changeLogPath, "utf8") : "";

for (const migrationName of migrationFiles) {
  const body = fs.readFileSync(path.join(migrationsDir, migrationName), "utf8");
  const declaredMigration = assertMetadata(migrationName, body, "Migration");
  const date = assertMetadata(migrationName, body, "Date");
  const type = assertMetadata(migrationName, body, "Type").toLowerCase();
  const summary = assertMetadata(migrationName, body, "Summary");
  const dataLossRaw = assertMetadata(migrationName, body, "Data loss").toLowerCase();
  const dataLoss = (dataLossRaw.match(/^(none|possible|intentional)\b/)?.[1] ?? dataLossRaw);
  const rollback = assertMetadata(migrationName, body, "Rollback");
  const changeLogReference = assertMetadata(migrationName, body, "Change log");

  if (declaredMigration && declaredMigration !== migrationName) {
    errors.push(`${migrationName}: -- Migration: はファイル名と一致させてください。現在=${declaredMigration}`);
  }
  if (date && !validDate(date)) errors.push(`${migrationName}: DateはYYYY-MM-DDの実在日付にしてください。現在=${date}`);
  if (type && !ALLOWED_TYPES.has(type)) {
    errors.push(`${migrationName}: Typeは${[...ALLOWED_TYPES].join(" / ")}のいずれかです。現在=${type}`);
  }
  if (dataLoss && !ALLOWED_DATA_LOSS.has(dataLoss)) {
    errors.push(`${migrationName}: Data lossはnone / possible / intentionalのいずれかです。現在=${dataLoss}`);
  }
  if (rollback && /todo|tbd|未定|あとで/i.test(rollback)) {
    errors.push(`${migrationName}: Rollbackに未確定表現を使用できません。`);
  }
  if (changeLogReference && !/docs\/database\/change-log\.md/i.test(changeLogReference)) {
    errors.push(`${migrationName}: Change logはdocs/database/change-log.mdを参照してください。`);
  }
  if (type === "destructive" && dataLoss === "none") {
    errors.push(`${migrationName}: destructive変更はData lossの影響をpossibleまたはintentionalで明示してください。`);
  }
  if (type === "destructive" && summary.length < 10) {
    errors.push(`${migrationName}: destructive変更のSummaryを具体化してください。`);
  }

  const occurrences = changeLog.split(migrationName).length - 1;
  if (occurrences === 0) errors.push(`${migrationName}: change-log.mdに対応項目がありません。`);
  if (occurrences > 1) errors.push(`${migrationName}: change-log.mdに重複項目があります。`);

  const detailPath = path.join(historyDir, migrationName.replace(/\.sql$/, ".md"));
  if (!fs.existsSync(detailPath)) {
    errors.push(`${migrationName}: ${path.relative(root, detailPath)} がありません。`);
    continue;
  }
  const detail = fs.readFileSync(detailPath, "utf8");
  if (!/Status:\s*Active/i.test(detail)) errors.push(`${migrationName}: DB履歴文書をStatus: Activeにしてください。`);
  if (!detail.includes(migrationName)) errors.push(`${migrationName}: DB履歴文書内にmigration名がありません。`);
  for (const section of ["目的", "変更内容", "データ損失", "ロールバック", "検証"]) {
    if (!new RegExp(`^#{1,6}\\s+.*${section}`, "mi").test(detail)) {
      errors.push(`${migrationName}: DB履歴文書に「${section}」節がありません。`);
    }
  }
}

for (const match of changeLog.matchAll(/\b\d{4}_[A-Za-z0-9_-]+\.sql\b/g)) {
  const migrationName = match[0];
  if (!migrationFiles.includes(migrationName)) {
    errors.push(`change-log.md: active migrationに存在しない${migrationName}が記載されています。HistoricalならHistorical文書へ移動してください。`);
  }
}

checkAppliedMigrationChanges(migrationFiles);

const historicalDir = path.join(migrationsDir, "historical");
const historicalFiles = fs.existsSync(historicalDir)
  ? fs.readdirSync(historicalDir, { recursive: true }).filter((item) => String(item).endsWith(".sql"))
  : [];
if (historicalFiles.length === 0) errors.push("migrations/historicalに旧migrationがありません。");

const historicalReadme = path.join(root, "docs", "historical", "README.md");
if (
  !fs.existsSync(historicalReadme) ||
  !/Status:\s*Historical/i.test(fs.readFileSync(historicalReadme, "utf8"))
) {
  errors.push("docs/historical/README.mdをStatus: Historicalとして明示してください。");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[check:db-history] ${error}`);
  process.exit(1);
}

console.log(`[check:db-history] OK: ${migrationFiles.length} active migrations validated.`);
