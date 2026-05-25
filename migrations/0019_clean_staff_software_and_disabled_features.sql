-- Final pre-production cleanup for staff permissions, software catalog links,
-- and disabled early-production features.

CREATE TABLE IF NOT EXISTS event_staff (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  x_user_id TEXT,
  discord_user_id TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  is_public INTEGER NOT NULL DEFAULT 0,
  public_role_label TEXT,
  internal_note TEXT,
  approved_by_user_id TEXT,
  approved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS event_staff_event_x_uniq
  ON event_staff (event_id, x_user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS event_staff_event_discord_uniq
  ON event_staff (event_id, discord_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS event_staff_event_idx
  ON event_staff (event_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS event_staff_permissions (
  id TEXT PRIMARY KEY,
  event_staff_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS event_staff_permissions_staff_key_uniq
  ON event_staff_permissions (event_staff_id, permission_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS event_staff_permissions_key_allowed_idx
  ON event_staff_permissions (permission_key, allowed);
--> statement-breakpoint

INSERT OR IGNORE INTO event_staff (
  id,
  event_id,
  x_user_id,
  discord_user_id,
  display_name,
  role,
  is_public,
  public_role_label,
  internal_note,
  approved_by_user_id,
  approved_at,
  created_at,
  updated_at
)
SELECT
  'es_' || e.event_id || '_x_' || lower(e.x_user_id),
  e.event_id,
  e.x_user_id,
  NULL,
  COALESCE(x.x_name, '@' || e.x_user_id),
  COALESCE(e.role, 'editor'),
  COALESCE(e.is_public, 1),
  e.public_role_label,
  e.internal_note,
  e.approved_by_user_id,
  e.approved_at,
  COALESCE(e.approved_at, unixepoch()),
  unixepoch()
FROM event_editors e
LEFT JOIN x_users x ON x.id = e.x_user_id;
--> statement-breakpoint

INSERT OR IGNORE INTO event_staff (
  id,
  event_id,
  x_user_id,
  discord_user_id,
  display_name,
  role,
  is_public,
  public_role_label,
  internal_note,
  approved_by_user_id,
  approved_at,
  created_at,
  updated_at
)
SELECT
  CASE
    WHEN p.x_user_id IS NOT NULL AND p.x_user_id <> ''
      THEN 'es_' || p.event_id || '_x_' || lower(p.x_user_id)
    WHEN p.discord_user_id IS NOT NULL AND p.discord_user_id <> ''
      THEN 'es_' || p.event_id || '_d_' || p.discord_user_id
    ELSE 'es_perm_' || p.id
  END,
  p.event_id,
  NULLIF(p.x_user_id, ''),
  NULLIF(p.discord_user_id, ''),
  p.display_name,
  'staff',
  COALESCE(p.is_public_staff, 0),
  p.public_role_label,
  NULL,
  p.granted_by_user_id,
  p.created_at,
  COALESCE(p.created_at, unixepoch()),
  COALESCE(p.updated_at, p.created_at, unixepoch())
FROM event_collaborator_permissions p;
--> statement-breakpoint

WITH permission_keys(permission_key) AS (
  VALUES
    ('event.basic'),
    ('event.slots'),
    ('event.members'),
    ('event.questions'),
    ('videos.title'),
    ('videos.music_credit'),
    ('videos.members'),
    ('videos.review_data'),
    ('videos.youtube_id'),
    ('videos.primary_event'),
    ('video.chapter_admin')
)
INSERT OR IGNORE INTO event_staff_permissions (
  id,
  event_staff_id,
  permission_key,
  allowed,
  created_at,
  updated_at
)
SELECT
  'esp_' || e.event_id || '_' || lower(e.x_user_id) || '_' || replace(k.permission_key, '.', '_'),
  'es_' || e.event_id || '_x_' || lower(e.x_user_id),
  k.permission_key,
  1,
  COALESCE(e.approved_at, unixepoch()),
  unixepoch()
FROM event_editors e
CROSS JOIN permission_keys k;
--> statement-breakpoint

INSERT OR IGNORE INTO event_staff_permissions (
  id,
  event_staff_id,
  permission_key,
  allowed,
  created_at,
  updated_at
)
SELECT
  'esp_legacy_' || p.id,
  CASE
    WHEN p.x_user_id IS NOT NULL AND p.x_user_id <> ''
      THEN 'es_' || p.event_id || '_x_' || lower(p.x_user_id)
    WHEN p.discord_user_id IS NOT NULL AND p.discord_user_id <> ''
      THEN 'es_' || p.event_id || '_d_' || p.discord_user_id
    ELSE 'es_perm_' || p.id
  END,
  p.permission_key,
  COALESCE(p.allowed, 1),
  COALESCE(p.created_at, unixepoch()),
  COALESCE(p.updated_at, p.created_at, unixepoch())
FROM event_collaborator_permissions p;
--> statement-breakpoint

DROP TABLE IF EXISTS event_collaborator_permissions;
--> statement-breakpoint
DROP TABLE IF EXISTS event_editors;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS video_softwares (
  video_id TEXT NOT NULL,
  software_id TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, software_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_softwares_software_video_idx
  ON video_softwares (software_id, video_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS video_softwares_video_order_idx
  ON video_softwares (video_id, order_index);
--> statement-breakpoint

INSERT OR IGNORE INTO software_catalog (
  id,
  name,
  normalized_name,
  created_at,
  updated_at
)
SELECT
  'sw_legacy_' || lower(hex(randomblob(8))),
  trim(used_software),
  lower(trim(used_software)),
  unixepoch(),
  unixepoch()
FROM videos
WHERE used_software IS NOT NULL
  AND trim(used_software) <> ''
GROUP BY lower(trim(used_software));
--> statement-breakpoint

INSERT OR IGNORE INTO video_softwares (
  video_id,
  software_id,
  raw_label,
  order_index
)
SELECT
  v.id,
  sc.id,
  trim(v.used_software),
  0
FROM videos v
INNER JOIN software_catalog sc
  ON sc.normalized_name = lower(trim(v.used_software))
WHERE v.used_software IS NOT NULL
  AND trim(v.used_software) <> '';
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

CREATE TABLE videos_clean (
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

INSERT INTO videos_clean (
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
FROM videos;
--> statement-breakpoint

DROP TABLE videos;
--> statement-breakpoint
ALTER TABLE videos_clean RENAME TO videos;
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

CREATE INDEX IF NOT EXISTS video_events_event_video_idx
  ON video_events (event_id, video_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS video_chapters_video_time_idx
  ON video_chapters (video_id, chapter_time);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS video_comments_video_created_idx
  ON video_comments (video_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS video_comments_chapter_idx
  ON video_comments (chapter_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS x_user_icons_user_created_idx
  ON x_user_icons (x_user_id, created_at);
--> statement-breakpoint

DROP TABLE IF EXISTS custom_pages;
--> statement-breakpoint
DROP TABLE IF EXISTS custom_themes;
--> statement-breakpoint
DROP TABLE IF EXISTS recommendation_signals;
