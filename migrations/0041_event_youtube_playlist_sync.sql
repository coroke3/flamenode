-- Migration: 0041_event_youtube_playlist_sync.sql
-- Date: 2026-07-13
-- Type: additive
-- Summary: Add event-scoped YouTube playlist sync settings and remote item index
-- Data loss: none
-- Rollback: disable playlist sync, then drop event_youtube_playlist_items and event_youtube_playlist_sync
-- Change log: docs/database/change-log.md

CREATE TABLE "event_youtube_playlist_sync" (
  "event_id" text PRIMARY KEY NOT NULL,
  "playlist_id" text,
  "enabled" integer NOT NULL DEFAULT 0,
  "sync_mode" text NOT NULL DEFAULT 'off',
  "sync_interval_minutes" integer NOT NULL DEFAULT 720,
  "sync_status" text NOT NULL DEFAULT 'disabled',
  "next_sync_at" integer,
  "last_synced_at" integer,
  "last_full_scan_at" integer,
  "scan_started_at" integer,
  "scan_page_token" text,
  "last_error" text,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON UPDATE no action ON DELETE cascade
);

CREATE INDEX "event_youtube_playlist_sync_due_idx"
  ON "event_youtube_playlist_sync" ("enabled", "next_sync_at", "event_id");

CREATE UNIQUE INDEX "event_youtube_playlist_sync_playlist_uniq"
  ON "event_youtube_playlist_sync" ("playlist_id")
  WHERE playlist_id IS NOT NULL AND playlist_id <> '';

CREATE TABLE "event_youtube_playlist_items" (
  "event_id" text NOT NULL,
  "playlist_item_id" text NOT NULL,
  "youtube_video_id" text NOT NULL,
  "seen_at" integer NOT NULL,
  "managed_by_flamenode" integer NOT NULL DEFAULT 0,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("event_id", "playlist_item_id"),
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON UPDATE no action ON DELETE cascade
);

CREATE INDEX "event_youtube_playlist_items_event_video_idx"
  ON "event_youtube_playlist_items" ("event_id", "youtube_video_id");

CREATE UNIQUE INDEX "event_youtube_playlist_items_playlist_item_uniq"
  ON "event_youtube_playlist_items" ("playlist_item_id");
