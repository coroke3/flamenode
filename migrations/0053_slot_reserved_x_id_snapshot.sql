-- Migration: 0053_slot_reserved_x_id_snapshot.sql
-- Date: 2026-08-07
-- Type: additive
-- Summary: 枠取得時X IDスナップショット列を追加し、既存のx_user_idがある行だけ安全にバックフィル
-- Data loss: none
-- Rollback: migration 適用前の D1 バックアップから復元
-- Change log: docs/database/change-log.md

ALTER TABLE slots ADD COLUMN reserved_x_id_snapshot TEXT;

UPDATE slots
SET reserved_x_id_snapshot = x_user_id
WHERE reserved_x_id_snapshot IS NULL
  AND x_user_id IS NOT NULL;
