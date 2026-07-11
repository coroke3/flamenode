-- Split mixed video core columns into clearer production-facing structures.

CREATE TABLE IF NOT EXISTS video_youtube_metadata (
  video_id TEXT PRIMARY KEY,
  youtube_video_id TEXT,
  youtube_privacy_status TEXT,
  youtube_availability_status TEXT,
  duration_seconds INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_youtube_metadata_youtube_idx
  ON video_youtube_metadata (youtube_video_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_youtube_metadata_sync_idx
  ON video_youtube_metadata (sync_status, synced_at);
--> statement-breakpoint

INSERT OR REPLACE INTO video_youtube_metadata (
  video_id,
  youtube_video_id,
  youtube_privacy_status,
  youtube_availability_status,
  duration_seconds,
  view_count,
  synced_at,
  sync_status,
  sync_error,
  updated_at
)
SELECT
  id,
  youtube_video_id,
  NULL,
  youtube_status,
  youtube_duration_seconds,
  COALESCE(youtube_view_count, 0),
  youtube_synced_at,
  COALESCE(youtube_sync_status, 'pending'),
  NULL,
  COALESCE(updated_at, unixepoch())
FROM videos;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS video_stats (
  video_id TEXT PRIMARY KEY,
  app_view_count INTEGER NOT NULL DEFAULT 0,
  app_like_count INTEGER NOT NULL DEFAULT 0,
  trending_view_count_24h INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_stats_score_idx
  ON video_stats (score);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_stats_trending_idx
  ON video_stats (trending_view_count_24h);
--> statement-breakpoint

INSERT OR REPLACE INTO video_stats (
  video_id,
  app_view_count,
  app_like_count,
  trending_view_count_24h,
  score,
  updated_at
)
SELECT
  id,
  COALESCE(view_count, 0),
  COALESCE(like_count, 0),
  COALESCE(trending_view_count_24h, 0),
  COALESCE(video_score, 0),
  COALESCE(updated_at, unixepoch())
FROM videos;
--> statement-breakpoint

INSERT INTO history_logs (
  table_name,
  record_id,
  action,
  before_data,
  after_data,
  operator_discord_id,
  retention_class,
  created_at
)
SELECT
  'videos',
  id,
  'UPDATE',
  json_object('validation_errors', validation_errors),
  json_object('migrated_to', 'history_logs', 'validation_errors', validation_errors),
  NULL,
  'normal',
  COALESCE(updated_at, unixepoch())
FROM videos
WHERE validation_errors IS NOT NULL
  AND trim(validation_errors) <> '';
--> statement-breakpoint

DROP INDEX IF EXISTS videos_visibility_status_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_scheduled_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_score_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_primary_event_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_submitted_by_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_creator_x_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_youtube_id_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_youtube_id_active_uniq;
--> statement-breakpoint

ALTER TABLE videos RENAME TO videos_0020_old;
--> statement-breakpoint

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  primary_event_id TEXT,
  creator_x_user_id TEXT,
  submitted_by_discord_user_id TEXT NOT NULL,
  collaboration_type TEXT NOT NULL DEFAULT 'individual',
  source_type TEXT NOT NULL DEFAULT 'youtube',
  creator_display_name TEXT NOT NULL,
  creator_display_name_yomi TEXT,
  creator_icon_url TEXT,
  title TEXT NOT NULL,
  music TEXT,
  credit TEXT,
  music_reference_url TEXT,
  closing_comment TEXT,
  youtube_video_id TEXT,
  stage_permission TEXT,
  intro_comment TEXT,
  highlights TEXT,
  production_story TEXT,
  custom_answers TEXT,
  visibility_status TEXT NOT NULL DEFAULT 'draft',
  scheduling_type TEXT DEFAULT 'slotted',
  scheduled_time INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

INSERT INTO videos (
  id,
  primary_event_id,
  creator_x_user_id,
  submitted_by_discord_user_id,
  collaboration_type,
  source_type,
  creator_display_name,
  creator_display_name_yomi,
  creator_icon_url,
  title,
  music,
  credit,
  music_reference_url,
  closing_comment,
  youtube_video_id,
  stage_permission,
  intro_comment,
  highlights,
  production_story,
  custom_answers,
  visibility_status,
  scheduling_type,
  scheduled_time,
  created_at,
  updated_at
)
SELECT
  id,
  primary_event_id,
  creator_x_user_id,
  submitted_by_discord_user_id,
  CASE WHEN submission_type = 'collab' THEN 'collab' ELSE 'individual' END,
  'youtube',
  display_name,
  display_name_yomi,
  icon_url,
  title,
  music,
  credit,
  music_reference_url,
  COALESCE(NULLIF(closing_comment, ''), outro_comment),
  youtube_video_id,
  stage_permission,
  intro_comment,
  highlights,
  production_story,
  CASE
    WHEN custom_answers IS NOT NULL
      AND trim(custom_answers) <> ''
      AND json_valid(custom_answers) = 1
      AND json_type(custom_answers) = 'object'
    THEN json_object(
      COALESCE(primary_event_id, 'global'),
      CASE
        WHEN declared_experience IS NOT NULL AND trim(declared_experience) <> ''
        THEN json_patch(
          custom_answers,
          json_object('declared_experience', declared_experience)
        )
        ELSE custom_answers
      END
    )
    WHEN declared_experience IS NOT NULL AND trim(declared_experience) <> ''
    THEN json_object(
      COALESCE(primary_event_id, 'global'),
      json_object('declared_experience', declared_experience)
    )
    ELSE NULL
  END,
  visibility_status,
  scheduling_type,
  scheduled_time,
  created_at,
  updated_at
FROM videos_0020_old;
--> statement-breakpoint

DROP TABLE videos_0020_old;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS videos_visibility_status_idx
  ON videos (visibility_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS videos_scheduled_idx
  ON videos (scheduled_time);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS videos_primary_event_idx
  ON videos (primary_event_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS videos_submitted_by_idx
  ON videos (submitted_by_discord_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS videos_creator_x_idx
  ON videos (creator_x_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS videos_youtube_id_idx
  ON videos (youtube_video_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS videos_youtube_id_active_uniq
  ON videos (youtube_video_id)
  WHERE youtube_video_id IS NOT NULL
    AND youtube_video_id <> ''
    AND visibility_status NOT IN ('archived', 'voided');
