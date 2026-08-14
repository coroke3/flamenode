-- Migration: 0057_x_id_slot_bind_recovery.sql
-- Date: 2026-08-14
-- Type: additive
-- Summary: X ID承認後の予約枠bind状態を追跡し、bounded recoveryとbind検索を可能にする
-- Data loss: none
-- Rollback: migration適用前バックアップから復元（indexのみDROP可能）
-- Change log: docs/database/change-log.md

ALTER TABLE x_identity_requests
  ADD COLUMN slot_bind_status TEXT NOT NULL DEFAULT 'complete';

ALTER TABLE x_identity_requests
  ADD COLUMN slot_bind_attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE x_identity_requests
  ADD COLUMN slot_bind_updated_at INTEGER;

CREATE INDEX IF NOT EXISTS x_identity_requests_slot_bind_pending_idx
  ON x_identity_requests (slot_bind_updated_at, id)
  WHERE status = 'approved' AND slot_bind_status = 'pending';

CREATE INDEX IF NOT EXISTS slots_reserved_unbound_by_owner_snapshot_idx
  ON slots (
    reserved_by_user_id,
    reserved_x_id_snapshot,
    event_id,
    start_time,
    sort_order,
    id
  )
  WHERE status = 'reserved' AND x_user_id IS NULL;
