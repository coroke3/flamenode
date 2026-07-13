-- Migration: 0040_free_tier_background_jobs.sql
-- Date: 2026-07-13
-- Type: additive
-- Summary: 無料枠向けの期限駆動YouTube同期、差分スコア更新、Discord DM再利用列とdispatch indexを追加
-- Data loss: none
-- Rollback: 追加indexとtriggerを削除し、追加列の除去が必要な場合はmigration前backupから手動復元
-- Change log: docs/database/change-log.md

ALTER TABLE "user" ADD COLUMN "discord_dm_channel_id" text;

ALTER TABLE "videos" ADD COLUMN "trending_view_count_24h" integer NOT NULL DEFAULT 0;
ALTER TABLE "videos" ADD COLUMN "score_dirty_at" integer;

ALTER TABLE "video_youtube_metadata" ADD COLUMN "next_sync_at" integer;
ALTER TABLE "video_youtube_metadata" ADD COLUMN "consecutive_failures" integer NOT NULL DEFAULT 0;

UPDATE "videos"
SET "score_dirty_at" = unixepoch()
WHERE "visibility_status" = 'public';

UPDATE "video_youtube_metadata"
SET "next_sync_at" = COALESCE("synced_at", 0);

CREATE INDEX "video_youtube_metadata_next_sync_idx"
ON "video_youtube_metadata" ("next_sync_at", "video_id");

CREATE INDEX "videos_score_dirty_idx"
ON "videos" ("score_dirty_at", "id");

CREATE INDEX "videos_score_stale_idx"
ON "videos" ("visibility_status", "score_updated_at", "id");

CREATE INDEX "notification_outbox_dispatch_idx"
ON "notification_outbox" ("status", "next_attempt_at", "created_at");

CREATE TRIGGER "video_youtube_metadata_score_dirty_insert"
AFTER INSERT ON "video_youtube_metadata"
BEGIN
  UPDATE "videos"
  SET "score_dirty_at" = unixepoch()
  WHERE "id" = NEW."video_id";
END;

CREATE TRIGGER "video_youtube_metadata_score_dirty_update"
AFTER UPDATE OF "view_count", "youtube_video_id" ON "video_youtube_metadata"
WHEN OLD."view_count" IS NOT NEW."view_count"
  OR OLD."youtube_video_id" IS NOT NEW."youtube_video_id"
BEGIN
  UPDATE "videos"
  SET "score_dirty_at" = unixepoch()
  WHERE "id" = NEW."video_id";
END;

CREATE TRIGGER "videos_score_inputs_dirty_update"
AFTER UPDATE OF "app_like_count", "trending_view_count_24h", "scheduled_time", "visibility_status" ON "videos"
WHEN OLD."app_like_count" IS NOT NEW."app_like_count"
  OR OLD."trending_view_count_24h" IS NOT NEW."trending_view_count_24h"
  OR OLD."scheduled_time" IS NOT NEW."scheduled_time"
  OR OLD."visibility_status" IS NOT NEW."visibility_status"
BEGIN
  UPDATE "videos"
  SET "score_dirty_at" = unixepoch()
  WHERE "id" = NEW."id";
END;
