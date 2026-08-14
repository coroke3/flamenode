-- Migration: 0055_notification_outbox_latest_idx.sql
-- Date: 2026-08-14
-- Type: additive
-- Summary: 通知管理画面の最新100件取得をcreated_at indexでbounded scanにする
-- Data loss: none
-- Rollback: DROP INDEX IF EXISTS notification_outbox_created_idx
-- Change log: docs/database/change-log.md

CREATE INDEX IF NOT EXISTS notification_outbox_created_idx
  ON notification_outbox(created_at DESC);
