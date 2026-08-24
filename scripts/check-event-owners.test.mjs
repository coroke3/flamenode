#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  findLocalD1Database,
  resolveDatabasePath,
} from "./check-event-owners.mjs";

const root = process.cwd();
const script = path.join(root, "scripts/check-event-owners.mjs");
const canonicalFixture = `
CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT NOT NULL);
CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE event_staff (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL REFERENCES x_users(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL, permission_preset TEXT NOT NULL DEFAULT 'public_staff',
  custom_permission_keys_json TEXT, is_public INTEGER NOT NULL DEFAULT 0,
  public_role_label TEXT, approved_by_auth_user_id TEXT, approved_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX event_staff_event_x_uniq ON event_staff(event_id, x_user_id);
CREATE TABLE flamenode_schema_meta (id TEXT PRIMARY KEY, version TEXT NOT NULL);
INSERT INTO flamenode_schema_meta VALUES ('current', '2026-08-24-observability-1');
`;

function runCheck(databasePath) {
  return spawnSync(process.execPath, [script, `--database=${databasePath}`], {
    encoding: "utf8",
    cwd: root,
  });
}

function withDb(seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-check-"));
  const dbPath = path.join(dir, "db.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(canonicalFixture);
  seed(db);
  db.close();
  return { dir, dbPath };
}

function seedHealthyLegacy(db) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO "user" (
      id, name, email, emailVerified, image, role, discord_id,
      is_banned, is_tos_accepted, terms_reaccept_required, can_create_events,
      created_at
    ) VALUES (?, ?, ?, NULL, NULL, 'user', '1', 0, 1, 0, 0, ?)`,
  ).run("usr_owner", "Owner", "owner@example.com", now);
  db.prepare(
    `INSERT INTO x_users (id, x_name, approval_status, approval_requested_at)
     VALUES (?, ?, 'approved', ?)`,
  ).run("owner_x", "@owner_x", now);
  db.prepare(
    `INSERT INTO events (
      id, title, event_type, visibility_status, allow_user_video_event_links,
      allow_unslotted_posts, allow_user_video_edits, max_slots_per_video,
      max_consecutive_slots_per_entry, slot_part_gap_minutes, slot_type,
      slot_visibility_mode, created_at, updated_at, public_api_enabled
    ) VALUES (
      'ev_ok', '健全イベント', 'event', 'public', 0, 0, 0, 1, 1, 0, 'time', 'public_name', ?, ?, 0
    )`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO event_staff (
      id, event_id, user_id, x_user_id, display_name, role, permission_preset,
      custom_permission_keys_json, is_public, public_role_label, internal_note,
      approved_by_user_id, approved_at, created_at, updated_at
    ) VALUES (
      'es_owner', 'ev_ok', 'usr_owner', 'owner_x', 'Owner', 'representative', 'owner',
      NULL, 1, NULL, NULL, 'usr_owner', ?, ?, ?
    )`,
  ).run(now, now, now);
}

test("正常データは exit 0", () => {
  const { dir, dbPath } = withDb(seedHealthy);
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0);
});

test("ownerなしは exit 1", () => {
  const { dir, dbPath } = withDb((db) => {
    seedHealthy(db);
    db.prepare(`DELETE FROM event_staff`).run();
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /owner_missing/);
});

test("eventなしは exit 1", () => {
  const { dir, dbPath } = withDb((db) => {
    seedHealthy(db);
    db.exec(`PRAGMA foreign_keys = OFF`);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, created_at, updated_at)
       VALUES ('es_orphan', 'ev_missing', 'owner_x', 'Orphan', 'public_staff', ?, ?)`,
    ).run(now, now);
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /event_missing/);
});

test("X ID重複は exit 1", () => {
  const { dir, dbPath } = withDb((db) => {
    seedHealthy(db);
    db.exec(`DROP INDEX IF EXISTS event_staff_event_x_uniq`);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, created_at, updated_at)
       VALUES ('es_xdup', 'ev_ok', 'owner_x', 'DupX', 'public_staff', ?, ?)`,
    ).run(now, now);
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate_x_user/);
});

test("X IDなしは exit 1", () => {
  const { dir, dbPath } = withDb((db) => {
    seedHealthy(db);
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec(`DROP TABLE event_staff`);
    db.exec(`
      CREATE TABLE "event_staff" (
        "id" text PRIMARY KEY NOT NULL,
        "event_id" text NOT NULL,
        "x_user_id" text,
        "user_id" text,
        "display_name" text NOT NULL,
        "role" text NOT NULL DEFAULT 'staff',
        "permission_preset" text NOT NULL DEFAULT 'public_staff',
        "custom_permission_keys_json" text,
        "is_public" integer NOT NULL DEFAULT 0,
        "public_role_label" text,
        "internal_note" text,
        "approved_by_user_id" text,
        "approved_at" integer,
        "created_at" integer NOT NULL,
        "updated_at" integer NOT NULL
      )
    `);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO event_staff (
        id, event_id, user_id, x_user_id, display_name, role, permission_preset,
        custom_permission_keys_json, is_public, public_role_label, internal_note,
        approved_by_user_id, approved_at, created_at, updated_at
      ) VALUES (
        'es_null', 'ev_ok', NULL, 'missing_x', 'Missing X', 'staff', 'public_staff',
        NULL, 0, NULL, NULL, 'usr_owner', ?, ?, ?
      )`,
    ).run(now, now, now);
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /x_user_missing/);
});

test("ownerなしのevent_staffは exit 1", () => {
  const { dir, dbPath } = withDb((db) => {
    seedHealthy(db);
    db.prepare(
      `UPDATE event_staff SET permission_preset = 'public_staff' WHERE id = 'es_owner'`,
    ).run();
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /owner_missing/);
});

test("DBなしは exit 2", () => {
  const result = runCheck(path.join(os.tmpdir(), "missing-owner-check.sqlite"));
  assert.equal(result.status, 2);
});

function makeCandidate(rootDir, name, version) {
  const dbPath = path.join(rootDir, name);
  const db = new DatabaseSync(dbPath);
  db.exec(canonicalFixture);
  db.prepare(
    "UPDATE flamenode_schema_meta SET version = ? WHERE id = 'current'",
  ).run(version);
  db.close();
  return dbPath;
}

function seedHealthy(db) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO x_users (id, x_name) VALUES (?, ?)`).run("owner_x", "@owner_x");
  db.prepare(`INSERT INTO events (id, title) VALUES ('ev_ok', 'Healthy Event')`).run();
  db.prepare(
    `INSERT INTO event_staff
      (id, event_id, x_user_id, display_name, permission_preset, is_public, created_at, updated_at)
     VALUES ('es_owner', 'ev_ok', 'owner_x', 'Owner', 'owner', 1, ?, ?)`,
  ).run(now, now);
}

test("ローカルD1はcanonical schema versionの候補を一意に選ぶ", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-resolve-"));
  fs.writeFileSync(path.join(dir, "metadata.sqlite"), "");
  const expected = makeCandidate(dir, "canonical.sqlite", "2026-08-24-observability-1");
  makeCandidate(dir, "legacy.sqlite", "2026-07-11-baseline-1");
  assert.equal(findLocalD1Database(dir), expected);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("canonical候補が0件または複数ならfail-closed", () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-resolve-"));
  makeCandidate(emptyDir, "legacy.sqlite", "2026-07-11-baseline-1");
  assert.equal(findLocalD1Database(emptyDir), null);
  fs.rmSync(emptyDir, { recursive: true, force: true });

  const multiDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-resolve-"));
  makeCandidate(multiDir, "one.sqlite", "2026-08-24-observability-1");
  makeCandidate(multiDir, "two.sqlite", "2026-08-24-observability-1");
  assert.equal(findLocalD1Database(multiDir), null);
  fs.rmSync(multiDir, { recursive: true, force: true });
});

test("明示databaseはローカル候補より優先される", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-resolve-"));
  const explicit = path.join(dir, "explicit.sqlite");
  makeCandidate(dir, "canonical.sqlite", "2026-08-24-observability-1");
  assert.equal(resolveDatabasePath({ explicit, rootDir: dir }), explicit);
  fs.rmSync(dir, { recursive: true, force: true });
});
