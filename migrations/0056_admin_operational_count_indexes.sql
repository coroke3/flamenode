-- Migration: 0056_admin_operational_count_indexes.sql
-- Date: 2026-08-14
-- Type: additive
-- Summary: 管理トップの pending/open 集計をpartial indexでbounded scanにする
-- Data loss: none
-- Rollback: DROP INDEX IF EXISTSで追加2 indexを削除する
-- Change log: docs/database/change-log.md

CREATE INDEX IF NOT EXISTS x_identity_requests_pending_type_idx
  ON x_identity_requests(request_type)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS video_moderation_cases_open_due_idx
  ON video_moderation_cases(due_at)
  WHERE status = 'open';
