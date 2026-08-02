-- Migration: 0050_x_identity_request_decisions.sql
-- Date: 2026-08-02
-- Type: additive
-- Summary: X ID申請の判断メタデータ列と監査ログの actor_x_user_id を追加
-- Data loss: none
-- Rollback: 適用前 D1 バックアップから復元
-- Change log: docs/database/change-log.md

ALTER TABLE x_identity_requests ADD COLUMN decision_reason TEXT;
ALTER TABLE x_identity_requests ADD COLUMN decided_by_auth_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE x_identity_requests ADD COLUMN decided_at INTEGER;

ALTER TABLE audit_logs ADD COLUMN actor_x_user_id TEXT;
