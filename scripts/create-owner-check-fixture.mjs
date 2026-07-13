#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const outDir = path.join(root, ".tmp");
const outPath = path.join(outDir, "owner-check.sqlite");
const baselinePath = path.join(
  root,
  "migrations/0000_flame_node_baseline.sql",
);

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

const db = new DatabaseSync(outPath);
const baseline = fs.readFileSync(baselinePath, "utf8");
db.exec(baseline);

const now = Math.floor(Date.now() / 1000);
db.prepare(
  `INSERT INTO "user" (
    id, name, email, emailVerified, image, role, discord_id,
    is_banned, is_tos_accepted, terms_reaccept_required, can_create_events,
    created_at
  ) VALUES (?, ?, ?, NULL, NULL, 'user', '1', 0, 1, 0, 0, ?)`,
).run("usr_owner", "Owner", "owner@example.com", now);

db.prepare(
  `INSERT INTO x_users (
    id, x_name, approval_status, approval_requested_at
  ) VALUES (?, ?, 'approved', ?)`,
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

db.close();
console.log(`[create-owner-check-fixture] wrote ${outPath}`);
