-- Migration: 0039_worker_free_tier_scale.sql
-- Date: 2026-07-13
-- Type: additive
-- Summary: 大規模データ時のスコア差分更新をbounded index scanにする
-- Data loss: none
-- Rollback: videos_score_refresh_idxを削除する
-- Change log: docs/database/change-log.md

CREATE INDEX IF NOT EXISTS videos_score_refresh_idx
  ON videos(visibility_status, score_updated_at, id);
