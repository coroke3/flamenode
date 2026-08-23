-- Migration: 0060_youtube_playlist_slot_order_index.sql
-- Date: 2026-08-23
-- Type: additive / index-only
-- Summary: Speed up YouTube playlist source ordering by submitted event slots.
-- Data loss: none
-- Rollback: DROP INDEX IF EXISTS slots_playlist_order_idx;

CREATE INDEX IF NOT EXISTS "slots_playlist_order_idx"
  ON "slots" ("event_id", "video_id", "start_time", "sort_order")
  WHERE "status" = 'submitted' AND "video_id" IS NOT NULL;

PRAGMA optimize;
