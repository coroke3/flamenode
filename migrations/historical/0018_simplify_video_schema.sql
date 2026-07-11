-- Production-prep cleanup for videos / video_members.
-- Keeps legacy values by renaming canonical columns and moving moderation state
-- into video_moderation_cases.

ALTER TABLE events ADD COLUMN video_form_settings_json TEXT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS video_moderation_cases (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  case_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  public_reason TEXT,
  private_note TEXT,
  due_at INTEGER,
  locked_until INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  related_x_user_id TEXT,
  created_by_user_id TEXT,
  resolved_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_moderation_cases_video_idx
  ON video_moderation_cases (video_id, created_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_moderation_cases_type_status_idx
  ON video_moderation_cases (case_type, status);
--> statement-breakpoint

INSERT OR IGNORE INTO video_moderation_cases (
  id,
  video_id,
  case_type,
  status,
  public_reason,
  private_note,
  due_at,
  locked_until,
  attempt_count,
  related_x_user_id,
  created_by_user_id,
  resolved_by_user_id,
  created_at,
  resolved_at
)
SELECT
  'vmc_xr_' || id,
  id,
  'x_reapply',
  CASE WHEN status = 'x_reapply_required' THEN 'open' ELSE 'resolved' END,
  x_reapply_public_reason,
  json_object(
    'request_id', x_reapply_request_id,
    'legacy_status', status
  ),
  x_reapply_due_at,
  x_reapply_locked_until,
  COALESCE(x_reapply_attempt_count, 0),
  x_reapply_rejected_x_user_id,
  owner_discord_user_id,
  NULL,
  COALESCE(x_reapply_started_at, updated_at, created_at, unixepoch()),
  CASE WHEN status = 'x_reapply_required' THEN NULL ELSE updated_at END
FROM videos
WHERE status = 'x_reapply_required'
   OR x_reapply_request_id IS NOT NULL
   OR x_reapply_started_at IS NOT NULL
   OR x_reapply_due_at IS NOT NULL
   OR x_reapply_rejected_x_user_id IS NOT NULL
   OR x_reapply_public_reason IS NOT NULL
   OR COALESCE(x_reapply_attempt_count, 0) > 0
   OR x_reapply_locked_until IS NOT NULL;
--> statement-breakpoint

INSERT OR IGNORE INTO video_moderation_cases (
  id,
  video_id,
  case_type,
  status,
  public_reason,
  private_note,
  due_at,
  locked_until,
  attempt_count,
  related_x_user_id,
  created_by_user_id,
  resolved_by_user_id,
  created_at,
  resolved_at
)
SELECT
  'vmc_void_' || id,
  id,
  CASE
    WHEN void_reason_category = 'duplicate' THEN 'duplicate'
    WHEN void_reason_category = 'x_id_invalid' THEN 'x_reapply'
    WHEN void_reason_category = 'operator_decision' THEN 'operator'
    ELSE 'void'
  END,
  CASE
    WHEN void_restored_at IS NOT NULL THEN 'cancelled'
    WHEN status = 'voided' OR voided_at IS NOT NULL THEN 'resolved'
    ELSE 'open'
  END,
  void_reason,
  json_object(
    'category', void_reason_category,
    'detail_private', void_detail_private,
    'physical_delete_candidate_at', void_physical_delete_candidate_at,
    'restored_by_user_id', void_restored_by_user_id,
    'restored_at', void_restored_at
  ),
  NULL,
  NULL,
  0,
  NULL,
  voided_by_user_id,
  COALESCE(void_restored_by_user_id, voided_by_user_id),
  COALESCE(voided_at, updated_at, created_at, unixepoch()),
  COALESCE(void_restored_at, voided_at)
FROM videos
WHERE status = 'voided'
   OR voided_by_user_id IS NOT NULL
   OR voided_at IS NOT NULL
   OR void_reason IS NOT NULL
   OR void_reason_category IS NOT NULL
   OR void_detail_private IS NOT NULL
   OR void_physical_delete_candidate_at IS NOT NULL
   OR void_restored_by_user_id IS NOT NULL
   OR void_restored_at IS NOT NULL;
--> statement-breakpoint

DROP INDEX IF EXISTS videos_status_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_owner_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_creator_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_youtube_id_active_uniq;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_youtube_id_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_scheduled_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_score_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS videos_primary_event_idx;
--> statement-breakpoint

CREATE TABLE videos_new (
  id TEXT PRIMARY KEY,
  primary_event_id TEXT,
  creator_x_user_id TEXT,
  submitted_by_discord_user_id TEXT NOT NULL,
  submission_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  display_name_yomi TEXT,
  icon_url TEXT,
  declared_experience TEXT,
  title TEXT NOT NULL,
  music TEXT,
  credit TEXT,
  music_reference_url TEXT,
  closing_comment TEXT,
  youtube_video_id TEXT,
  stage_permission TEXT,
  intro_comment TEXT,
  outro_comment TEXT,
  highlights TEXT,
  production_story TEXT,
  used_software TEXT,
  custom_answers TEXT,
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  youtube_view_count INTEGER DEFAULT 0,
  youtube_synced_at INTEGER,
  youtube_status TEXT,
  youtube_duration_seconds INTEGER,
  trending_view_count_24h INTEGER DEFAULT 0,
  video_score REAL DEFAULT 0,
  youtube_sync_status TEXT DEFAULT 'pending',
  validation_errors TEXT,
  visibility_status TEXT NOT NULL DEFAULT 'draft',
  scheduling_type TEXT DEFAULT 'slotted',
  scheduled_time INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

INSERT INTO videos_new (
  id,
  primary_event_id,
  creator_x_user_id,
  submitted_by_discord_user_id,
  submission_type,
  display_name,
  display_name_yomi,
  icon_url,
  declared_experience,
  title,
  music,
  credit,
  music_reference_url,
  closing_comment,
  youtube_video_id,
  stage_permission,
  intro_comment,
  outro_comment,
  highlights,
  production_story,
  used_software,
  custom_answers,
  view_count,
  like_count,
  youtube_view_count,
  youtube_synced_at,
  youtube_status,
  youtube_duration_seconds,
  trending_view_count_24h,
  video_score,
  youtube_sync_status,
  validation_errors,
  visibility_status,
  scheduling_type,
  scheduled_time,
  created_at,
  updated_at
)
SELECT
  id,
  primary_event_id,
  COALESCE(creator_id, contact_x_id),
  owner_discord_user_id,
  submission_type,
  display_name,
  display_name_yomi,
  icon_url,
  declared_experience,
  title,
  music,
  credit,
  music_reference_url,
  closing_comment,
  youtube_video_id,
  stage_permission,
  intro_comment,
  outro_comment,
  highlights,
  production_story,
  used_software,
  custom_answers,
  view_count,
  like_count,
  youtube_view_count,
  youtube_synced_at,
  youtube_status,
  youtube_duration_seconds,
  trending_view_count_24h,
  video_score,
  youtube_sync_status,
  validation_errors,
  CASE
    WHEN status = 'voided' THEN 'voided'
    WHEN COALESCE(is_deleted, 0) = 1 THEN 'archived'
    WHEN COALESCE(is_manual_hidden, 0) = 1 THEN 'hidden'
    WHEN status = 'unlisted' THEN 'limited'
    WHEN status IN ('draft', 'pending', 'public', 'private') THEN status
    WHEN status = 'x_reapply_required' THEN 'pending'
    ELSE 'draft'
  END,
  scheduling_type,
  scheduled_time,
  created_at,
  updated_at
FROM videos;
--> statement-breakpoint

DROP TABLE videos;
--> statement-breakpoint
ALTER TABLE videos_new RENAME TO videos;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS videos_visibility_status_idx
  ON videos (visibility_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS videos_scheduled_idx
  ON videos (scheduled_time);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS videos_score_idx
  ON videos (video_score);
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
--> statement-breakpoint

DROP INDEX IF EXISTS video_members_video_order_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS video_members_video_name_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS video_members_video_name_for_sort_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS video_member_chapters_video_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS video_member_chapters_member_idx;
DROP INDEX IF EXISTS video_collaborators_video_idx;
DROP INDEX IF EXISTS video_collaborators_x_uniq;
DROP INDEX IF EXISTS video_collaborators_discord_uniq;
--> statement-breakpoint

CREATE TABLE video_members_new (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  x_user_id TEXT,
  name TEXT NOT NULL,
  role TEXT,
  comment TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  chapters_json TEXT,
  discord_user_id TEXT,
  can_edit INTEGER NOT NULL DEFAULT 0,
  is_public_member INTEGER NOT NULL DEFAULT 1,
  edit_granted_by_user_id TEXT,
  edit_granted_at INTEGER,
  edit_updated_at INTEGER
);
--> statement-breakpoint

INSERT INTO video_members_new (
  id,
  video_id,
  x_user_id,
  name,
  role,
  comment,
  order_index,
  chapters_json,
  discord_user_id,
  can_edit,
  is_public_member,
  edit_granted_by_user_id,
  edit_granted_at,
  edit_updated_at
)
SELECT
  vm.id,
  vm.video_id,
  vm.x_user_id,
  vm.name,
  vm.role,
  vm.comment,
  vm.order_index,
  (
    SELECT
      CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE json_group_array(
          json_object(
            'time_seconds', chapter_time,
            'label', chapter_label,
            'note', COALESCE(note, '')
          )
        )
      END
    FROM (
      SELECT chapter_time, chapter_label, note
      FROM video_member_chapters
      WHERE video_member_id = vm.id
      ORDER BY COALESCE(order_index, 0), chapter_time
    )
  ),
  vm.discord_user_id,
  vm.can_edit,
  vm.is_public_member,
  vm.edit_granted_by_user_id,
  vm.edit_granted_at,
  vm.edit_updated_at
FROM video_members vm;
--> statement-breakpoint

DROP TABLE video_members;
--> statement-breakpoint
ALTER TABLE video_members_new RENAME TO video_members;
--> statement-breakpoint
DROP TABLE IF EXISTS video_member_chapters;
DROP TABLE IF EXISTS video_collaborators;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_members_video_order_idx
  ON video_members (video_id, order_index);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS video_members_video_name_idx
  ON video_members (video_id, name);
