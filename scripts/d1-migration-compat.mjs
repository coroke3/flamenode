import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const D1_COMPAT_MIGRATION_NAME = "0045_align_visibility_defaults.sql";

// 0045 は events / videos を再作成する。D1 migrations の transaction 内では
// PRAGMA foreign_keys=OFF が有効にならず、これらの従属行がCASCADE/SET NULLされる。
// 適用済みmigration本文は変更せず、Wranglerへ渡す一時コピーだけを補強する。
export const D1_COMPAT_PRESERVED_TABLES = Object.freeze([
  "event_group_events",
  "event_staff",
  "event_youtube_playlist_items",
  "event_youtube_playlist_sync",
  "slots",
  "video_chapters",
  "video_events",
  "video_interactions",
  "video_members",
  "video_moderation_cases",
  "video_softwares",
  "video_youtube_metadata",
]);

const SNAPSHOT_ANCHOR = "PRAGMA foreign_keys = OFF;\n\n";
const RESTORE_ANCHOR =
  "PRAGMA foreign_keys = ON;\n\nDROP TRIGGER IF EXISTS events_visibility_status_canonical_insert;";
const COMPAT_MARKER = "D1_0045_COMPAT_PRESERVE_BEGIN";

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function assertSingleAnchor(source, anchor, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(
      `${D1_COMPAT_MIGRATION_NAME}: ${label} anchor count must be 1 (actual=${count})`,
    );
  }
}

function backupTableName(tableName) {
  return `_migration_0045_preserve_${tableName}`;
}

export function buildD1CompatibleMigration(migrationName, source) {
  if (migrationName !== D1_COMPAT_MIGRATION_NAME) return source;
  const normalizedSource = source.replaceAll("\r\n", "\n");
  if (normalizedSource.includes(COMPAT_MARKER)) {
    throw new Error(`${migrationName}: compatibility marker already exists`);
  }
  assertSingleAnchor(normalizedSource, SNAPSHOT_ANCHOR, "snapshot");
  assertSingleAnchor(normalizedSource, RESTORE_ANCHOR, "restore");

  const snapshots = [
    `-- ${COMPAT_MARKER}`,
    'CREATE TABLE "_migration_0045_preserve_video_event" AS',
    'SELECT "id", "primary_event_id" FROM "videos";',
    ...D1_COMPAT_PRESERVED_TABLES.map((tableName) => {
      const backupName = backupTableName(tableName);
      return `CREATE TABLE ${quoteIdentifier(backupName)} AS SELECT * FROM ${quoteIdentifier(tableName)};`;
    }),
    "-- D1_0045_COMPAT_PRESERVE_SNAPSHOT_END",
  ].join("\n");

  const restores = [
    "-- D1_0045_COMPAT_PRESERVE_RESTORE_BEGIN",
    'UPDATE "videos"',
    'SET "primary_event_id" = (',
    '  SELECT original."primary_event_id"',
    '  FROM "_migration_0045_preserve_video_event" original',
    '  WHERE original."id" = "videos"."id"',
    ");",
    ...D1_COMPAT_PRESERVED_TABLES.map((tableName) => {
      const backupName = backupTableName(tableName);
      return `INSERT INTO ${quoteIdentifier(tableName)} SELECT * FROM ${quoteIdentifier(backupName)};`;
    }),
    ...D1_COMPAT_PRESERVED_TABLES.map((tableName) =>
      `DROP TABLE ${quoteIdentifier(backupTableName(tableName))};`,
    ),
    'DROP TABLE "_migration_0045_preserve_video_event";',
    "-- D1_0045_COMPAT_PRESERVE_END",
  ].join("\n");

  return normalizedSource
    .replace(SNAPSHOT_ANCHOR, `${SNAPSHOT_ANCHOR}${snapshots}\n\n`)
    .replace(RESTORE_ANCHOR, `${restores}\n\n${RESTORE_ANCHOR}`);
}

export function materializeD1CompatibleMigrations(migrationsDir) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-d1-compatible-"));
  const outputDir = path.join(workspace, "migrations");
  fs.mkdirSync(outputDir);

  const migrationNames = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const source = fs.readFileSync(path.join(migrationsDir, migrationName), "utf8");
    fs.writeFileSync(
      path.join(outputDir, migrationName),
      buildD1CompatibleMigration(migrationName, source),
      "utf8",
    );
  }

  return { workspace, outputDir, migrationNames };
}
