#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildD1CompatibleMigration } from "./d1-migration-compat.mjs";

const root = process.cwd();
const migrationName = "0043_db_canonical_migration.sql";
const canonicalVersion = "2026-07-20-canonical-1";
const migrationsDir = path.join(root, "migrations");
const fixturePath = path.join(root, "scripts/fixtures/db-canonical-legacy.sql");
const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const activeMigrations = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();

function runWrangler(args, cwd) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [`wrangler ${args.join(" ")} failed`, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function createWorkspace({ withLegacyFixture }) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-d1-migration-"));
  const workspaceMigrations = path.join(workspace, "migrations");
  fs.mkdirSync(workspaceMigrations);
  const databaseId = randomUUID();
  const databaseName = `flamenode_db_${databaseId.replaceAll("-", "").slice(0, 12)}`;
  fs.writeFileSync(
    path.join(workspace, "wrangler.toml"),
    `name = "flamenode-db-migration-check"\ncompatibility_date = "2026-07-20"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${databaseName}"\ndatabase_id = "${databaseId}"\nmigrations_dir = "migrations"\n`,
  );
  for (const name of activeMigrations) {
    const source = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    fs.writeFileSync(
      path.join(workspaceMigrations, name),
      buildD1CompatibleMigration(name, source),
      "utf8",
    );
  }
  if (withLegacyFixture) {
    fs.writeFileSync(
      path.join(workspaceMigrations, "0042z_db_canonical_legacy_fixture.sql"),
      fs.readFileSync(fixturePath, "utf8"),
    );
  }
  return {
    workspace,
    config: path.join(workspace, "wrangler.toml"),
    persist: path.join(workspace, "persist"),
    databaseName,
  };
}

function databasePath(persist) {
  const pending = [persist];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") {
        return candidate;
      }
    }
  }
  throw new Error(`D1 local SQLite file not found under ${persist}`);
}

function assertCanonicalD1(context, expectedCounts = null) {
  const db = new DatabaseSync(databasePath(context.persist));
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' AND substr(name,1,4) <> '_cf_' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    const columnCount = tables.reduce((sum, tableName) => {
      const escaped = tableName.replaceAll('"', '""');
      return sum + db.prepare(`PRAGMA table_info("${escaped}")`).all().length;
    }, 0);
    assert.equal(tables.length, 44, "D1 canonical table count");
    // Keep this baseline in sync with the additive migrations. 0057 adds the
    // three slot-bind recovery columns and 0058 adds the event description
    // template column; a stale count makes every empty-D1 preflight fail even
    // though the migrated schema is valid.
    assert.equal(columnCount, 442, "D1 canonical column count");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
    assert.equal(
      db.prepare("SELECT version FROM flamenode_schema_meta WHERE id='current'").get()?.version,
      canonicalVersion,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM events e WHERE NOT EXISTS (SELECT 1 FROM event_staff es WHERE es.event_id=e.id AND es.permission_preset='owner')").get().count,
      0,
      "D1 ownerless events",
    );
    if (expectedCounts) {
      for (const [tableName, count] of Object.entries(expectedCounts)) {
        const escaped = tableName.replaceAll('"', '""');
        assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM "${escaped}"`).get().count, count, tableName);
      }
      assert.deepEqual(
        db.prepare("SELECT id,max_slots_per_video FROM events ORDER BY id").all().map((row) => ({ ...row })),
        [
          { id: "e1", max_slots_per_video: 3 },
          { id: "e2", max_slots_per_video: 2 },
          { id: "e3", max_slots_per_video: 4 },
        ],
      );
    }
  } finally {
    db.close();
  }
}

function runCase(mode) {
  const withLegacyFixture = mode === "legacy";
  const context = createWorkspace({ withLegacyFixture });
  try {
    runWrangler(
      [
        "d1",
        "migrations",
        "apply",
        context.databaseName,
        "--local",
        "--persist-to",
        context.persist,
        "--config",
        context.config,
      ],
      context.workspace,
    );
    assertCanonicalD1(
      context,
      withLegacyFixture
        ? {
            x_identity_requests: 4,
            x_user_account_links: 2,
            events: 3,
            video_members: 2,
            video_youtube_metadata: 2,
            video_chapters: 2,
          }
        : null,
    );
  } finally {
    fs.rmSync(context.workspace, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
if (mode !== "empty" && mode !== "legacy") {
  throw new Error("Usage: node scripts/check-db-d1-migration.mjs <empty|legacy>");
}
runCase(mode);
console.log(`[check:db-d1-migration] OK: ${mode === "empty" ? "empty D1" : "legacy fixture D1"}`);
