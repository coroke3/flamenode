-- Migration: 0038_runtime_efficiency_resilience.sql
-- Date: 2026-07-13
-- Type: additive
-- Summary: Worker leaseの実行状態列と公開・認証読取経路の複合indexを追加する
-- Data loss: none
-- Rollback: 追加indexを削除し、必要時はmigration前backupからworker_leasesを手動復元する
-- Change log: docs/database/change-log.md

-- Runtime resilience and read-path efficiency.
-- Apply before deploying code that reads worker_leases.last_* columns.

ALTER TABLE worker_leases ADD COLUMN last_started_at INTEGER;
ALTER TABLE worker_leases ADD COLUMN last_succeeded_at INTEGER;
ALTER TABLE worker_leases ADD COLUMN last_failed_at INTEGER;
ALTER TABLE worker_leases ADD COLUMN last_error_code TEXT;

-- Public list/order paths.
CREATE INDEX IF NOT EXISTS videos_public_scheduled_idx
  ON videos(visibility_status, scheduled_time DESC);

CREATE INDEX IF NOT EXISTS videos_public_score_idx
  ON videos(visibility_status, score DESC, scheduled_time DESC);

CREATE INDEX IF NOT EXISTS events_visibility_start_idx
  ON events(visibility_status, start_time DESC);

-- Auth/X-ID resolution.
CREATE INDEX IF NOT EXISTS x_users_linked_approval_idx
  ON x_users(linked_user_id, approval_status, id);

-- Icon/name fallback: individual first, then collaboration, newest first.
CREATE INDEX IF NOT EXISTS videos_creator_fallback_idx
  ON videos(creator_x_user_id, collaboration_type, created_at DESC)
  WHERE creator_x_user_id IS NOT NULL
    AND visibility_status NOT IN ('archived', 'voided')
    AND (creator_icon_url IS NOT NULL OR creator_display_name IS NOT NULL);
