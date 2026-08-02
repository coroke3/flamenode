#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const migrationsDir = path.join(root, "migrations");
const migrationName = "0043_db_canonical_migration.sql";
const canonicalVersion = "2026-07-20-canonical-1";
const legacyVersion = "2026-07-11-baseline-1";
const migrationSql = fs.readFileSync(path.join(migrationsDir, migrationName), "utf8");
const activeMigrations = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();
const preCanonicalMigrations = activeMigrations.filter((name) => name < migrationName);

const removedTables = [
  "audit_log_settings",
  "legacy_import_batch_items",
  "legacy_import_batches",
  "x_account_link_requests",
  "x_id_merge_reverts",
  "x_id_merge_requests",
  "x_user_icons",
  "x_user_youtube_channels",
];
const deletedColumns = [
  ["x_users", "linked_user_id"],
  ["x_users", "verification_token"],
  ["x_users", "token_expires_at"],
  ["x_users", "approval_requested_at"],
  ["event_group_events", "sort_order"],
  ["event_staff", "user_id"],
  ["event_staff", "role"],
  ["event_staff", "internal_note"],
  ["events", "representative_x_user_id"],
  ["events", "max_consecutive_slots_per_entry"],
  ["events", "public_api_updated_at"],
  ["slots", "slot_kind"],
  ["slots", "priority_reclaim_video_id"],
  ["slots", "priority_reclaim_until"],
  ["software_aliases", "id"],
  ["system_settings", "history_retention_days"],
  ["video_chapters", "show_on_player_bar"],
  ["video_chapters", "order_index"],
  ["video_interactions", "id"],
  ["video_interactions", "source"],
  ["video_interactions", "synced_at"],
  ["video_members", "user_id"],
  ["video_members", "chapters_json"],
  ["video_softwares", "order_index"],
  ["video_youtube_metadata", "youtube_video_id"],
];

function executeMigration(db, name, sqlText) {
  if (name !== migrationName) {
    db.exec(sqlText);
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sqlText);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function createLegacyDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of preCanonicalMigrations) {
    executeMigration(db, name, fs.readFileSync(path.join(migrationsDir, name), "utf8"));
  }
  assert.equal(schemaVersion(db), legacyVersion);
  return db;
}

function applyAllMigrations() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of activeMigrations) {
    executeMigration(db, name, fs.readFileSync(path.join(migrationsDir, name), "utf8"));
  }
  return db;
}

function applyPostCanonicalMigrations(db) {
  for (const name of activeMigrations.filter((entry) => entry > migrationName)) {
    executeMigration(db, name, fs.readFileSync(path.join(migrationsDir, name), "utf8"));
  }
}

function schemaVersion(db) {
  return db.prepare("SELECT version FROM flamenode_schema_meta WHERE id = 'current'").get()?.version;
}

function tableExists(db, tableName) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

function columns(db, tableName) {
  const escaped = tableName.replaceAll('"', '""');
  return db.prepare(`PRAGMA table_info("${escaped}")`).all();
}

function plainRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function assertCanonicalShape(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String(row.name));
  const columnCount = tables.reduce((total, tableName) => total + columns(db, tableName).length, 0);
  assert.equal(tables.length, 41, "canonical table count");
  assert.equal(columnCount, 425, "canonical column count");
  for (const tableName of removedTables) assert.equal(tableExists(db, tableName), false, tableName);
  for (const [tableName, columnName] of deletedColumns) {
    assert.equal(
      columns(db, tableName).some((column) => column.name === columnName),
      false,
      `${tableName}.${columnName}`,
    );
  }
  assert.equal(columns(db, "event_staff").some((column) => column.name === "approved_by_user_id"), false);
  assert.equal(columns(db, "event_staff").some((column) => column.name === "approved_by_auth_user_id"), true);
  assert.equal(columns(db, "video_members").some((column) => column.name === "edit_granted_by_user_id"), false);
  assert.equal(columns(db, "video_members").some((column) => column.name === "edit_granted_by_auth_user_id"), true);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
  assert.equal(schemaVersion(db), canonicalVersion);
}

function seedLegacyFixture(db) {
  db.exec(fs.readFileSync(path.join(root, "scripts/fixtures/db-canonical-legacy.sql"), "utf8"));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
}

function expectMigrationFailure(db, expectedMessage) {
  assert.throws(
    () => executeMigration(db, migrationName, migrationSql),
    new RegExp(expectedMessage),
  );
}

function testEmptyDatabase() {
  const db = applyAllMigrations();
  try {
    assertCanonicalShape(db);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM events e WHERE NOT EXISTS (SELECT 1 FROM event_staff es WHERE es.event_id=e.id AND es.permission_preset='owner')").get().count,
      0,
    );
  } finally {
    db.close();
  }
}

function testLegacyFixture() {
  const db = createLegacyDatabase();
  try {
    seedLegacyFixture(db);
    executeMigration(db, migrationName, migrationSql);
    applyPostCanonicalMigrations(db);
    assertCanonicalShape(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM x_identity_requests").get().count, 4);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM x_user_account_links").get().count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events").get().count, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM video_members").get().count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM video_youtube_metadata").get().count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM video_chapters").get().count, 2);
    assert.deepEqual(
      plainRows(db.prepare("SELECT id,max_slots_per_video FROM events ORDER BY id").all()),
      [
        { id: "e1", max_slots_per_video: 3 },
        { id: "e2", max_slots_per_video: 2 },
        { id: "e3", max_slots_per_video: 4 },
      ],
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM events e WHERE NOT EXISTS (SELECT 1 FROM event_staff es WHERE es.event_id=e.id AND es.permission_preset='owner')").get().count,
      0,
    );
    assert.deepEqual(
      plainRows(db.prepare("SELECT id,youtube_video_id FROM videos ORDER BY id").all()),
      [{ id: "v1", youtube_video_id: "yt1" }, { id: "v2", youtube_video_id: "yt2" }],
    );
    assert.equal(
      db.prepare("SELECT approved_by_auth_user_id FROM event_staff WHERE id='s1'").get().approved_by_auth_user_id,
      "u2",
    );
    assert.equal(
      db.prepare("SELECT edit_granted_by_auth_user_id FROM video_members WHERE id='vm1'").get().edit_granted_by_auth_user_id,
      "u2",
    );
    expectMigrationFailure(db, "migration_0043_expected_legacy_schema");
    assertCanonicalShape(db);
  } finally {
    db.close();
  }
}

function testInvalidLegacyDataFailsBeforeDestruction() {
  const db = createLegacyDatabase();
  try {
    seedLegacyFixture(db);
    db.prepare("UPDATE video_members SET chapters_json = 'not-json' WHERE id = 'vm1'").run();
    expectMigrationFailure(db, "migration_0043_valid_chapters_json_array");
    assert.equal(schemaVersion(db), legacyVersion);
    assert.equal(tableExists(db, "video_members"), true);
    assert.equal(columns(db, "video_members").some((column) => column.name === "chapters_json"), true);
    assert.equal(tableExists(db, "x_identity_requests"), false);
  } finally {
    db.close();
  }
}

function testPartialStateIsRejected() {
  const db = createLegacyDatabase();
  try {
    db.prepare("UPDATE flamenode_schema_meta SET version = ? WHERE id = 'current'").run(
      `${canonicalVersion}-in-progress`,
    );
    expectMigrationFailure(db, "migration_0043_expected_legacy_schema");
    assert.equal(schemaVersion(db), `${canonicalVersion}-in-progress`);
    assert.equal(tableExists(db, "x_account_link_requests"), true);
  } finally {
    db.close();
  }
}

for (const [name, test] of [
  ["empty database", testEmptyDatabase],
  ["legacy fixture", testLegacyFixture],
  ["invalid legacy data", testInvalidLegacyDataFailsBeforeDestruction],
  ["partial state", testPartialStateIsRejected],
]) {
  test();
  console.log(`[check:db-migration] OK: ${name}`);
}
