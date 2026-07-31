-- Migration: 0045_align_visibility_defaults.sql
-- Date: 2026-07-31
-- Type: cleanup
-- Summary: Align events/videos physical defaults with canonical visibility states and drop insert-normalization triggers
-- Data loss: none
-- Rollback: restore the pre-migration D1 backup because table DDL changes
-- Change log: docs/database/change-log.md

CREATE TABLE "_migration_0045_status_guard" (
  "ok" integer NOT NULL CHECK ("ok" = 1)
);

INSERT INTO "_migration_0045_status_guard" ("ok")
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM events
    WHERE visibility_status NOT IN ('private', 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM videos
    WHERE visibility_status NOT IN ('pending', 'public', 'private', 'voided')
  )
  THEN 1
  ELSE 0
END;

DROP TABLE "_migration_0045_status_guard";

PRAGMA foreign_keys = OFF;

CREATE TABLE "events_new" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "event_type" text DEFAULT 'event' CHECK ("event_type" IN ('event', 'collabo', 'type', 'other')),
  "explanation" text,
  "icon_url" text,
  "img_url" text,
  "accent_color" text,
  "visibility_status" text NOT NULL DEFAULT 'private' CHECK ("visibility_status" IN ('private', 'public')),
  "allow_user_video_event_links" integer NOT NULL DEFAULT 0,
  "allow_unslotted_posts" integer NOT NULL DEFAULT 0,
  "allow_user_video_edits" integer NOT NULL DEFAULT 0,
  "user_video_edit_permission_keys_json" text,
  "slot_type" text DEFAULT 'time' CHECK ("slot_type" IN ('time', 'count')),
  "slot_visibility_mode" text DEFAULT 'public_name' CHECK ("slot_visibility_mode" IN ('public_name', 'anonymous', 'hidden')),
  "start_time" integer,
  "end_time" integer,
  "entry_start_time" integer,
  "entry_end_time" integer,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  "max_slots_per_video" integer NOT NULL DEFAULT 1,
  "review_settings" text,
  "editable_fields" text,
  "repeat_rules" text,
  "slot_part_gap_minutes" integer DEFAULT 15,
  "parts_json" text,
  "public_api_enabled" integer NOT NULL DEFAULT 0
);

INSERT INTO "events_new"
SELECT
  "id",
  "title",
  "event_type",
  "explanation",
  "icon_url",
  "img_url",
  "accent_color",
  "visibility_status",
  "allow_user_video_event_links",
  "allow_unslotted_posts",
  "allow_user_video_edits",
  "user_video_edit_permission_keys_json",
  "slot_type",
  "slot_visibility_mode",
  "start_time",
  "end_time",
  "entry_start_time",
  "entry_end_time",
  "created_at",
  "updated_at",
  "max_slots_per_video",
  "review_settings",
  "editable_fields",
  "repeat_rules",
  "slot_part_gap_minutes",
  "parts_json",
  "public_api_enabled"
FROM "events";

DROP TABLE "events";
ALTER TABLE "events_new" RENAME TO "events";

CREATE INDEX "events_visibility_start_idx"
  ON "events" ("visibility_status", "start_time" DESC);

CREATE TABLE "videos_new" (
  "id" text PRIMARY KEY NOT NULL,
  "primary_event_id" text,
  "creator_x_user_id" text,
  "submitted_by_user_id" text NOT NULL,
  "collaboration_type" text NOT NULL DEFAULT 'individual',
  "part" text,
  "source_type" text NOT NULL DEFAULT 'youtube',
  "creator_display_name" text NOT NULL,
  "creator_display_name_yomi" text,
  "creator_icon_url" text,
  "creator_youtube_channel_url" text,
  "title" text NOT NULL,
  "music" text,
  "credit" text,
  "music_reference_url" text,
  "closing_comment" text,
  "youtube_video_id" text,
  "intro_comment" text,
  "highlights" text,
  "production_story" text,
  "visibility_status" text NOT NULL DEFAULT 'pending',
  "scheduling_type" text DEFAULT 'slotted',
  "scheduled_time" integer,
  "app_like_count" integer NOT NULL DEFAULT 0,
  "score" real NOT NULL DEFAULT 0,
  "score_updated_at" integer,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY ("primary_event_id") REFERENCES "events"("id") ON DELETE SET NULL,
  FOREIGN KEY ("creator_x_user_id") REFERENCES "x_users"("id") ON DELETE SET NULL,
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT
);

INSERT INTO "videos_new"
SELECT
  "id",
  "primary_event_id",
  "creator_x_user_id",
  "submitted_by_user_id",
  "collaboration_type",
  "part",
  "source_type",
  "creator_display_name",
  "creator_display_name_yomi",
  "creator_icon_url",
  "creator_youtube_channel_url",
  "title",
  "music",
  "credit",
  "music_reference_url",
  "closing_comment",
  "youtube_video_id",
  "intro_comment",
  "highlights",
  "production_story",
  "visibility_status",
  "scheduling_type",
  "scheduled_time",
  "app_like_count",
  "score",
  "score_updated_at",
  "created_at",
  "updated_at"
FROM "videos";

DROP TABLE "videos";
ALTER TABLE "videos_new" RENAME TO "videos";

CREATE INDEX "videos_creator_fallback_idx"
  ON "videos" ("creator_x_user_id", "collaboration_type", "created_at")
  WHERE "creator_x_user_id" IS NOT NULL
    AND "visibility_status" NOT IN ('archived', 'voided')
    AND ("creator_icon_url" IS NOT NULL OR "creator_display_name" IS NOT NULL);

CREATE INDEX "videos_creator_public_idx"
  ON "videos" ("creator_x_user_id", "visibility_status", "primary_event_id", "id");

CREATE INDEX "videos_creator_x_idx" ON "videos" ("creator_x_user_id");
CREATE INDEX "videos_primary_event_idx" ON "videos" ("primary_event_id");
CREATE INDEX "videos_public_scheduled_idx" ON "videos" ("visibility_status", "scheduled_time");
CREATE INDEX "videos_public_score_idx" ON "videos" ("visibility_status", "score", "scheduled_time");
CREATE INDEX "videos_scheduled_idx" ON "videos" ("scheduled_time");
CREATE INDEX "videos_score_refresh_idx" ON "videos" ("visibility_status", "score_updated_at", "id");
CREATE INDEX "videos_submitted_by_idx" ON "videos" ("submitted_by_user_id");
CREATE INDEX "videos_visibility_status_idx" ON "videos" ("visibility_status");

CREATE UNIQUE INDEX "videos_youtube_id_active_uniq" ON "videos" ("youtube_video_id")
  WHERE "youtube_video_id" IS NOT NULL
    AND "youtube_video_id" <> ''
    AND "visibility_status" NOT IN ('archived', 'voided');

CREATE INDEX "videos_youtube_id_idx" ON "videos" ("youtube_video_id");

PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS events_visibility_status_canonical_insert;
DROP TRIGGER IF EXISTS videos_visibility_status_canonical_insert;

DROP TRIGGER IF EXISTS events_visibility_status_reject_insert;
CREATE TRIGGER events_visibility_status_reject_insert
BEFORE INSERT ON events
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('private', 'public')
BEGIN
  SELECT RAISE(ABORT, 'events.visibility_status must be private or public');
END;

DROP TRIGGER IF EXISTS videos_visibility_status_reject_insert;
CREATE TRIGGER videos_visibility_status_reject_insert
BEFORE INSERT ON videos
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('pending', 'public', 'private', 'voided')
BEGIN
  SELECT RAISE(ABORT, 'videos.visibility_status must be canonical');
END;

CREATE TABLE "_migration_0045_default_guard" (
  "ok" integer NOT NULL CHECK ("ok" = 1)
);

INSERT INTO "_migration_0045_default_guard" ("ok")
SELECT CASE
  WHEN (
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'
  ) LIKE '%DEFAULT ''private''%'
  AND (
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'videos'
  ) LIKE '%DEFAULT ''pending''%'
  AND NOT EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (
        'events_visibility_status_canonical_insert',
        'videos_visibility_status_canonical_insert'
      )
  )
  THEN 1
  ELSE 0
END;

DROP TABLE "_migration_0045_default_guard";
