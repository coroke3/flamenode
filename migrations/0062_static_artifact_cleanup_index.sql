-- Migration: 0062_static_artifact_cleanup_index.sql
-- Date: 2026-09-25
-- Type: additive
-- Summary: add a partial index for bounded live static artifact cleanup
-- Data loss: none
-- Rollback: DROP INDEX IF EXISTS static_artifacts_live_cleanup_idx
-- Change log: docs/database/change-log.d/0062_static_artifact_cleanup_index.md

CREATE INDEX IF NOT EXISTS static_artifacts_live_cleanup_idx
ON static_artifacts (target_type, target_id, generated_at, object_key)
WHERE deleted_at IS NULL;
