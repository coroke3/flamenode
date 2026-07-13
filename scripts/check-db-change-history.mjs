#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "migrations");
const changeLogPath = path.join(
  root,
  "docs",
  "database",
  "change-log.md",
);
const historyDir = path.join(root, "docs", "db-history");
const errors = [];

const migrationFiles = fs
  .readdirSync(migrationsDir, {
    withFileTypes: true,
  })
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".sql"),
  )
  .map((entry) => entry.name)
  .sort();

const ALLOWED_TYPES = new Set([
  "baseline",
  "schema",
  "data",
  "index",
  "constraint",
  "security",
  "cleanup",
]);

const ALLOWED_DATA_LOSS = new Set([
  "none",
  "possible",
  "intentional",
]);

function read(relative) {
  return fs.readFileSync(
    path.join(root, relative),
    "utf8",
  );
}

function metadataValue(body, key) {
  const match = body.match(
    new RegExp(
      `^--\\s*${key}:\\s*(.+?)\\s*$`,
      "mi",
    ),
  );
  return match?.[1]?.trim() ?? "";
}

function assertMetadata(
  migrationName,
  body,
  key,
) {
  const value = metadataValue(body, key);
  if (!value) {
    errors.push(
      `${migrationName}: -- ${key}: がありません。`,
    );
  }
  return value;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

if (!fs.existsSync(changeLogPath)) {
  errors.push(
    "docs/database/change-log.md がありません。",
  );
}

const changeLog = fs.existsSync(changeLogPath)
  ? fs.readFileSync(changeLogPath, "utf8")
  : "";

const seenChangeLogEntries = new Set();

for (const migrationName of migrationFiles) {
  const migrationPath = path.join(
    migrationsDir,
    migrationName,
  );
  const body = fs.readFileSync(
    migrationPath,
    "utf8",
  );

  const declaredMigration = assertMetadata(
    migrationName,
    body,
    "Migration",
  );
  const date = assertMetadata(
    migrationName,
    body,
    "Date",
  );
  const type = assertMetadata(
    migrationName,
    body,
    "Type",
  ).toLowerCase();
  assertMetadata(
    migrationName,
    body,
    "Summary",
  );
  const dataLoss = assertMetadata(
    migrationName,
    body,
    "Data loss",
  ).toLowerCase();
  const rollback = assertMetadata(
    migrationName,
    body,
    "Rollback",
  );
  const changeLogReference = assertMetadata(
    migrationName,
    body,
    "Change log",
  );

  if (
    declaredMigration &&
    declaredMigration !== migrationName
  ) {
    errors.push(
      `${migrationName}: -- Migration: はファイル名と一致させてください。現在=${declaredMigration}`,
    );
  }

  if (date && !validDate(date)) {
    errors.push(
      `${migrationName}: DateはYYYY-MM-DDの実在日付にしてください。現在=${date}`,
    );
  }

  if (type && !ALLOWED_TYPES.has(type)) {
    errors.push(
      `${migrationName}: Typeが不正です。現在=${type}`,
    );
  }

  if (
    dataLoss &&
    !ALLOWED_DATA_LOSS.has(dataLoss)
  ) {
    errors.push(
      `${migrationName}: Data lossはnone / possible / intentionalのいずれかです。現在=${dataLoss}`,
    );
  }

  if (
    rollback &&
    /todo|tbd|未定|あとで/i.test(rollback)
  ) {
    errors.push(
      `${migrationName}: Rollbackに未確定表現を使用できません。`,
    );
  }

  if (
    changeLogReference &&
    !/docs\/database\/change-log\.md/i.test(
      changeLogReference,
    )
  ) {
    errors.push(
      `${migrationName}: Change logはdocs/database/change-log.mdを参照してください。`,
    );
  }

  const occurrences = changeLog
    .split(migrationName).length - 1;

  if (occurrences === 0) {
    errors.push(
      `${migrationName}: change-log.mdに対応項目がありません。`,
    );
  }

  if (occurrences > 1) {
    errors.push(
      `${migrationName}: change-log.mdに重複項目があります。`,
    );
  }

  seenChangeLogEntries.add(migrationName);

  const detailPath = path.join(
    historyDir,
    migrationName.replace(/\.sql$/, ".md"),
  );

  if (!fs.existsSync(detailPath)) {
    errors.push(
      `${migrationName}: ${path.relative(
        root,
        detailPath,
      )} がありません。`,
    );
    continue;
  }

  const detail = fs.readFileSync(
    detailPath,
    "utf8",
  );

  if (!/Status:\s*Active/i.test(detail)) {
    errors.push(
      `${migrationName}: DB履歴文書をStatus: Activeにしてください。`,
    );
  }

  if (!detail.includes(migrationName)) {
    errors.push(
      `${migrationName}: DB履歴文書内にmigration名がありません。`,
    );
  }

  const requiredSections = [
    "目的",
    "変更内容",
    "データ損失",
    "ロールバック",
    "検証",
  ];

  for (const section of requiredSections) {
    const heading = new RegExp(
      `^#{1,6}\\s+.*${section}`,
      "mi",
    );

    if (!heading.test(detail)) {
      errors.push(
        `${migrationName}: DB履歴文書に「${section}」節がありません。`,
      );
    }
  }
}

for (const match of changeLog.matchAll(
  /\b\d{4}_[A-Za-z0-9_-]+\.sql\b/g,
)) {
  const migrationName = match[0];

  if (!migrationFiles.includes(migrationName)) {
    errors.push(
      `change-log.md: active migrationに存在しない${migrationName}が記載されています。Historicalなら明示的にHistorical節へ移動してください。`,
    );
  }
}

const historicalDir = path.join(
  migrationsDir,
  "historical",
);
const historicalFiles = fs.existsSync(
  historicalDir,
)
  ? fs
      .readdirSync(historicalDir, {
        recursive: true,
      })
      .filter((item) =>
        String(item).endsWith(".sql"),
      )
  : [];

if (historicalFiles.length === 0) {
  errors.push(
    "migrations/historicalに旧migrationがありません。",
  );
}

const historicalReadme = path.join(
  root,
  "docs",
  "historical",
  "README.md",
);

if (
  !fs.existsSync(historicalReadme) ||
  !/Status:\s*Historical/i.test(
    fs.readFileSync(historicalReadme, "utf8"),
  )
) {
  errors.push(
    "docs/historical/README.mdをStatus: Historicalとして明示してください。",
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(
      `[check:db-history] ${error}`,
    );
  }
  process.exit(1);
}

console.log(
  `[check:db-history] OK: ${migrationFiles.length} active migrations validated.`,
);
