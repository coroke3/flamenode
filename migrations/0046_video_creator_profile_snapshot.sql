-- Migration: 0046_video_creator_profile_snapshot.sql
-- Date: 2026-08-01
-- Type: additive
-- Summary: 作品投稿時点の提出者プロフィールを videos へスナップショット列として追加し、既存行を x_users からバックフィル
-- Data loss: none（過去提出時点の値は復元不可。本 migration 実行時点の x_users を固定する）
-- Rollback: migration 適用前の D1 バックアップから復元
-- Change log: docs/database/change-log.md

-- 制約: creator_profile_text / creator_other_social_links は提出時スナップショット。
-- 過去提出時点の値は復元不可。本 migration のバックフィルは実行時点の x_users を固定する。

ALTER TABLE videos ADD COLUMN creator_profile_text TEXT;

ALTER TABLE videos ADD COLUMN creator_other_social_links TEXT;

UPDATE videos
SET creator_profile_text = (
  SELECT x.profile_text
  FROM x_users x
  WHERE x.id = videos.creator_x_user_id
)
WHERE videos.creator_profile_text IS NULL
  AND videos.creator_x_user_id IS NOT NULL;

UPDATE videos
SET creator_other_social_links = (
  SELECT x.other_social_links
  FROM x_users x
  WHERE x.id = videos.creator_x_user_id
)
WHERE videos.creator_other_social_links IS NULL
  AND videos.creator_x_user_id IS NOT NULL;

UPDATE videos
SET creator_youtube_channel_url = (
  SELECT x.youtube_channel_url
  FROM x_users x
  WHERE x.id = videos.creator_x_user_id
)
WHERE videos.creator_youtube_channel_url IS NULL
  AND videos.creator_x_user_id IS NOT NULL;

UPDATE videos
SET creator_icon_url = (
  SELECT x.icon_url
  FROM x_users x
  WHERE x.id = videos.creator_x_user_id
)
WHERE videos.creator_icon_url IS NULL
  AND videos.creator_x_user_id IS NOT NULL;
