-- Migration: 0051_slot_reservation_groups_expand.sql
-- Date: 2026-08-02
-- Type: additive
-- Summary: slot_reservation_groups テーブル追加（expand 期間は slots 旧列を維持）
-- Data loss: none
-- Rollback: migration 適用前バックアップから復元
-- Change log: docs/database/change-log.md

CREATE TABLE IF NOT EXISTS slot_reservation_groups (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reserved_by_auth_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  x_user_id TEXT REFERENCES x_users(id) ON DELETE SET NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS slot_reservation_groups_event_idx
  ON slot_reservation_groups (event_id);
