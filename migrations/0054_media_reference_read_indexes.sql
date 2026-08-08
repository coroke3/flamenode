-- Migration: 0054_media_reference_read_indexes.sql
-- Date: 2026-08-08
-- Type: additive
-- Summary: public-media参照確認で使う6つのnullable URL列へpartial equality indexを追加しD1 rows_readを削減
-- Data loss: none
-- Rollback: DROP INDEX IF EXISTSで0054の6 indexを削除する。データ行への変更はない。
-- Change log: docs/database/change-log.md

-- D1 rows_read optimization for public-media orphan/reference checks.
-- These columns are read with equality predicates before deleting an R2 object.
-- Partial indexes avoid indexing the overwhelmingly common NULL case.

CREATE INDEX IF NOT EXISTS x_users_icon_url_idx
  ON x_users(icon_url)
  WHERE icon_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS videos_creator_icon_url_idx
  ON videos(creator_icon_url)
  WHERE creator_icon_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_icon_url_idx
  ON events(icon_url)
  WHERE icon_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_img_url_idx
  ON events(img_url)
  WHERE img_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_groups_icon_url_idx
  ON event_groups(icon_url)
  WHERE icon_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_groups_img_url_idx
  ON event_groups(img_url)
  WHERE img_url IS NOT NULL;
