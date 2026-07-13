#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const script = path.join(root, "scripts/check-event-owners.mjs");
const baseline = fs.readFileSync(
  path.join(root, "migrations/0000_flame_node_baseline.sql"),
  "utf8",
);

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
  db.exec(baseline);
  seed(db);
  db.close();
  return { dir, dbPath };
}

function seedHealthy(db) {
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

test("user重複は exit 1", () => {
  const { dir, dbPath } = withDb((db) => {
    seedHealthy(db);
    db.exec(`DROP INDEX IF EXISTS event_staff_event_user_uniq`);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO event_staff (
        id, event_id, user_id, x_user_id, display_name, role, permission_preset,
        custom_permission_keys_json, is_public, public_role_label, internal_note,
        approved_by_user_id, approved_at, created_at, updated_at
      ) VALUES (
        'es_dup', 'ev_ok', 'usr_owner', NULL, 'Dup', 'staff', 'public_staff',
        NULL, 0, NULL, NULL, 'usr_owner', ?, ?, ?
      )`,
    ).run(now, now, now);
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate_user/);
});

test("X ID重複は exit 1", () => {
  const { dir, dbPath } = withDb((db) => {
    seedHealthy(db);
    db.exec(`DROP INDEX IF EXISTS event_staff_event_x_uniq`);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO event_staff (
        id, event_id, user_id, x_user_id, display_name, role, permission_preset,
        custom_permission_keys_json, is_public, public_role_label, internal_note,
        approved_by_user_id, approved_at, created_at, updated_at
      ) VALUES (
        'es_xdup', 'ev_ok', NULL, 'owner_x', 'DupX', 'staff', 'public_staff',
        NULL, 0, NULL, NULL, 'usr_owner', ?, ?, ?
      )`,
    ).run(now, now, now);
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate_x_user/);
});

test("null主体は exit 1", () => {
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
        'es_null', 'ev_ok', NULL, NULL, 'Null', 'staff', 'public_staff',
        NULL, 0, NULL, NULL, 'usr_owner', ?, ?, ?
      )`,
    ).run(now, now, now);
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /subject_missing/);
});

test("role不一致は exit 1", () => {
  const { dir, dbPath } = withDb((db) => {
    seedHealthy(db);
    db.prepare(
      `UPDATE event_staff SET role = 'staff' WHERE id = 'es_owner'`,
    ).run();
  });
  const result = runCheck(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /role_preset_mismatch/);
});

test("DBなしは exit 2", () => {
  const result = runCheck(path.join(os.tmpdir(), "missing-owner-check.sqlite"));
  assert.equal(result.status, 2);
});
