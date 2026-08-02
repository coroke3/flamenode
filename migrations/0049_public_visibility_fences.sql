-- Migration: 0049_public_visibility_fences.sql
-- Date: 2026-08-02
-- Type: additive
-- Summary: public_visibility_fences テーブル追加
-- Data loss: none
-- Rollback: migration 適用前バックアップから復元
-- Change log: docs/database/change-log.md

CREATE TABLE IF NOT EXISTS public_visibility_fences (
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('video', 'event', 'x_user', 'event_group')
  ),
  entity_id TEXT NOT NULL,
  fence_token TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('blocked', 'release_pending', 'released')
  ),
  reason TEXT,
  requirements_json TEXT,
  blocked_at INTEGER,
  release_requested_at INTEGER,
  requested_by_auth_user_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS public_visibility_fences_state_updated_idx
  ON public_visibility_fences (state, updated_at);
