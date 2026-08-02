-- Migration: 0048_cleanup_video_visibility_indexes.sql
-- Date: 2026-08-02
-- Type: cleanup
-- Summary: Additive video visibility probe indexes for public static target checks
-- Data loss: none
-- Rollback: migration 適用前バックアップから復元
-- Change log: docs/database/change-log.md

CREATE INDEX IF NOT EXISTS videos_public_id_probe_idx
  ON videos (id, visibility_status)
  WHERE visibility_status = 'public';

CREATE INDEX IF NOT EXISTS videos_youtube_public_probe_idx
  ON videos (youtube_video_id, visibility_status)
  WHERE visibility_status = 'public'
    AND youtube_video_id IS NOT NULL
    AND youtube_video_id <> '';
