-- Migration: 0039_search_relation_indexes.sql
-- Date: 2026-07-13
-- Type: additive
-- Summary: 公開作品検索・クリエイター集計・公開チャプター検索の複合indexを追加する
-- Data loss: none
-- Rollback: 追加した3つのindexをDROP INDEXで削除する
-- Change log: docs/database/change-log.md

CREATE INDEX IF NOT EXISTS videos_creator_public_idx
  ON videos(creator_x_user_id, visibility_status, primary_event_id, id);

CREATE INDEX IF NOT EXISTS video_members_x_user_video_idx
  ON video_members(x_user_id, video_id);

CREATE INDEX IF NOT EXISTS video_chapters_video_visibility_idx
  ON video_chapters(video_id, visibility);
