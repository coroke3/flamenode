-- 0044: DB正本化 — backfill 後に旧列・旧テーブルを物理削除する。
-- 方針: visibility_status / event_custom_questions / video_custom_answers /
--       event_group_events / operation_mode / used_software_json / audit_logs が正本。

-- ============================================================
-- 1. operation_mode 最終 backfill
-- ============================================================
UPDATE system_settings
SET operation_mode = 'maintenance'
WHERE (is_maintenance_mode = 1 OR is_maintenance_mode = true)
  AND (operation_mode IS NULL OR operation_mode = 'normal');

UPDATE system_settings
SET operation_mode = cost_guard_mode
WHERE cost_guard_mode IS NOT NULL
  AND cost_guard_mode <> ''
  AND cost_guard_mode <> 'normal'
  AND (operation_mode IS NULL OR operation_mode = 'normal');

-- ============================================================
-- 2. event_group_events 最終 backfill
-- ============================================================
INSERT OR IGNORE INTO event_group_events (
  event_group_id, event_id, relation_type, sort_order, created_at, updated_at
)
SELECT event_group_id, id, 'member', 0, unixepoch(), unixepoch()
FROM events
WHERE event_group_id IS NOT NULL AND trim(event_group_id) <> '';

-- ============================================================
-- 3. video_member_chapters 新テーブル + backfill
-- ============================================================
CREATE TABLE IF NOT EXISTS video_member_chapters (
  id TEXT PRIMARY KEY NOT NULL,
  video_member_id TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL,
  label TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS video_member_chapters_member_sort_idx
  ON video_member_chapters (video_member_id, sort_order);

INSERT OR IGNORE INTO video_member_chapters (
  id, video_member_id, start_time, end_time, label, note, sort_order, created_at, updated_at
)
SELECT
  vm.id || ':' || je.key,
  vm.id,
  COALESCE(
    CAST(json_extract(je.value, '$.time_seconds') AS REAL),
    CAST(json_extract(je.value, '$.time') AS REAL),
    CAST(json_extract(je.value, '$.chapter_time') AS REAL),
    0
  ),
  CAST(json_extract(je.value, '$.end_time') AS REAL),
  COALESCE(
    NULLIF(trim(CAST(json_extract(je.value, '$.label') AS TEXT)), ''),
    NULLIF(trim(CAST(json_extract(je.value, '$.chapter_label') AS TEXT)), ''),
    '担当'
  ),
  NULLIF(trim(CAST(json_extract(je.value, '$.note') AS TEXT)), ''),
  COALESCE(CAST(json_extract(je.value, '$.order_index') AS INTEGER), CAST(je.key AS INTEGER), 0),
  unixepoch(),
  unixepoch()
FROM video_members vm
JOIN json_each(vm.chapters_json) je
WHERE vm.chapters_json IS NOT NULL
  AND trim(vm.chapters_json) <> ''
  AND json_valid(vm.chapters_json) = 1;

-- video_chapters.video_member_id 付き行を member_chapters へ
INSERT OR IGNORE INTO video_member_chapters (
  id, video_member_id, start_time, end_time, label, note, sort_order, created_at, updated_at
)
SELECT
  'vc_' || vc.id,
  vc.video_member_id,
  vc.chapter_time,
  NULL,
  vc.chapter_label,
  vc.note,
  COALESCE(vc.order_index, 0),
  COALESCE(vc.created_at, unixepoch()),
  COALESCE(vc.updated_at, unixepoch())
FROM video_chapters vc
WHERE vc.video_member_id IS NOT NULL
  AND trim(vc.video_member_id) <> '';

-- ============================================================
-- 4. 旧テーブル削除
-- ============================================================
DROP TABLE IF EXISTS history_logs;
DROP TABLE IF EXISTS event_staff_permissions;
DROP TABLE IF EXISTS video_softwares;
DROP TABLE IF EXISTS video_stats;
DROP TABLE IF EXISTS api_endpoints;
DROP TABLE IF EXISTS video_comments;

-- ============================================================
-- 5. events 再作成 (旧列除去)
-- ============================================================
CREATE TABLE events_new (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  event_type TEXT DEFAULT 'event',
  explanation TEXT,
  icon_url TEXT,
  img_url TEXT,
  accent_color TEXT,
  representative_x_user_id TEXT,
  visibility_status TEXT NOT NULL DEFAULT 'draft',
  allow_user_video_event_links INTEGER NOT NULL DEFAULT 0,
  allow_user_video_edits INTEGER NOT NULL DEFAULT 0,
  user_video_edit_permission_keys_json TEXT,
  slot_type TEXT DEFAULT 'time',
  slot_visibility_mode TEXT DEFAULT 'public_name',
  start_time INTEGER,
  end_time INTEGER,
  entry_start_time INTEGER,
  entry_end_time INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  max_slots_per_video INTEGER NOT NULL DEFAULT 1,
  max_consecutive_slots_per_entry INTEGER NOT NULL DEFAULT 3,
  review_settings TEXT,
  editable_fields TEXT,
  repeat_rules TEXT,
  slot_part_gap_minutes INTEGER DEFAULT 15,
  parts_json TEXT,
  public_api_enabled INTEGER NOT NULL DEFAULT 0,
  public_api_updated_at INTEGER
);

INSERT INTO events_new (
  id, title, event_type, explanation, icon_url, img_url, accent_color,
  representative_x_user_id, visibility_status,
  allow_user_video_event_links, allow_user_video_edits, user_video_edit_permission_keys_json,
  slot_type, slot_visibility_mode, start_time, end_time, entry_start_time, entry_end_time,
  created_at, updated_at, max_slots_per_video, max_consecutive_slots_per_entry,
  review_settings, editable_fields, repeat_rules, slot_part_gap_minutes, parts_json,
  public_api_enabled, public_api_updated_at
)
SELECT
  id, title, event_type, explanation, icon_url, img_url, accent_color,
  representative_x_user_id,
  COALESCE(NULLIF(trim(visibility_status), ''), 'draft'),
  allow_user_video_event_links, allow_user_video_edits, user_video_edit_permission_keys_json,
  slot_type, slot_visibility_mode, start_time, end_time, entry_start_time, entry_end_time,
  created_at, updated_at, max_slots_per_video, max_consecutive_slots_per_entry,
  review_settings, editable_fields, repeat_rules, slot_part_gap_minutes, parts_json,
  public_api_enabled, public_api_updated_at
FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

-- ============================================================
-- 6. videos 再作成
-- ============================================================
CREATE TABLE videos_new (
  id TEXT PRIMARY KEY NOT NULL,
  primary_event_id TEXT,
  creator_x_user_id TEXT,
  submitted_by_discord_user_id TEXT NOT NULL,
  collaboration_type TEXT NOT NULL DEFAULT 'individual',
  part TEXT,
  source_type TEXT NOT NULL DEFAULT 'youtube',
  creator_display_name TEXT NOT NULL,
  creator_display_name_yomi TEXT,
  creator_icon_url TEXT,
  creator_youtube_channel_url TEXT,
  title TEXT NOT NULL,
  music TEXT,
  credit TEXT,
  music_reference_url TEXT,
  closing_comment TEXT,
  youtube_video_id TEXT,
  intro_comment TEXT,
  highlights TEXT,
  production_story TEXT,
  visibility_status TEXT NOT NULL DEFAULT 'draft',
  scheduling_type TEXT DEFAULT 'slotted',
  scheduled_time INTEGER,
  used_software_json TEXT,
  app_like_count INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  trending_view_count_24h INTEGER NOT NULL DEFAULT 0,
  score_updated_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO videos_new SELECT
  id, primary_event_id, creator_x_user_id, submitted_by_discord_user_id,
  collaboration_type, part, source_type, creator_display_name, creator_display_name_yomi,
  creator_icon_url, creator_youtube_channel_url, title, music, credit, music_reference_url,
  closing_comment, youtube_video_id, intro_comment, highlights, production_story,
  visibility_status, scheduling_type, scheduled_time, used_software_json,
  app_like_count, score, trending_view_count_24h, score_updated_at, created_at, updated_at
FROM videos;

DROP TABLE videos;
ALTER TABLE videos_new RENAME TO videos;

CREATE INDEX IF NOT EXISTS videos_visibility_status_idx ON videos (visibility_status);
CREATE INDEX IF NOT EXISTS videos_scheduled_idx ON videos (scheduled_time);
CREATE INDEX IF NOT EXISTS videos_primary_event_idx ON videos (primary_event_id);
CREATE INDEX IF NOT EXISTS videos_submitted_by_idx ON videos (submitted_by_discord_user_id);
CREATE INDEX IF NOT EXISTS videos_creator_x_idx ON videos (creator_x_user_id);
CREATE INDEX IF NOT EXISTS videos_youtube_id_idx ON videos (youtube_video_id);
CREATE UNIQUE INDEX IF NOT EXISTS videos_youtube_id_active_uniq ON videos (youtube_video_id)
  WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> ''
    AND visibility_status NOT IN ('archived', 'voided');

-- ============================================================
-- 7. video_members 再作成
-- ============================================================
CREATE TABLE video_members_new (
  id TEXT PRIMARY KEY NOT NULL,
  video_id TEXT NOT NULL,
  x_user_id TEXT,
  name TEXT NOT NULL,
  role TEXT,
  comment TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  discord_user_id TEXT,
  can_edit INTEGER NOT NULL DEFAULT 0,
  is_public_member INTEGER NOT NULL DEFAULT 1,
  edit_granted_by_user_id TEXT,
  edit_granted_at INTEGER,
  edit_updated_at INTEGER
);

INSERT INTO video_members_new SELECT
  id, video_id, x_user_id, name, role, comment, order_index,
  discord_user_id, can_edit, is_public_member,
  edit_granted_by_user_id, edit_granted_at, edit_updated_at
FROM video_members;

DROP TABLE video_members;
ALTER TABLE video_members_new RENAME TO video_members;

CREATE INDEX IF NOT EXISTS video_members_video_order_idx ON video_members (video_id, order_index);
CREATE INDEX IF NOT EXISTS video_members_video_name_idx ON video_members (video_id, name);
CREATE INDEX IF NOT EXISTS video_members_video_can_edit_idx ON video_members (video_id, can_edit);
CREATE INDEX IF NOT EXISTS video_members_discord_idx ON video_members (discord_user_id);

-- ============================================================
-- 8. video_chapters 再作成 (通常チャプターのみ)
-- ============================================================
CREATE TABLE video_chapters_new (
  id TEXT PRIMARY KEY NOT NULL,
  video_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  chapter_time REAL NOT NULL,
  chapter_label TEXT NOT NULL,
  note TEXT,
  visibility TEXT DEFAULT 'public',
  show_on_player_bar INTEGER DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO video_chapters_new (
  id, video_id, x_user_id, chapter_time, chapter_label, note,
  visibility, show_on_player_bar, order_index, created_at, updated_at
)
SELECT
  id, video_id, x_user_id, chapter_time, chapter_label, note,
  visibility, show_on_player_bar, order_index, created_at, updated_at
FROM video_chapters
WHERE video_member_id IS NULL OR trim(video_member_id) = '';

DROP TABLE video_chapters;
ALTER TABLE video_chapters_new RENAME TO video_chapters;

CREATE INDEX IF NOT EXISTS video_chapters_video_time_idx ON video_chapters (video_id, chapter_time);

-- ============================================================
-- 9. system_settings 再作成
-- ============================================================
CREATE TABLE system_settings_new (
  id TEXT PRIMARY KEY NOT NULL,
  default_editable_fields TEXT,
  upcoming_editable_fields TEXT,
  history_retention_days INTEGER DEFAULT 90,
  operation_mode TEXT DEFAULT 'normal',
  auto_cost_guard_enabled INTEGER DEFAULT 1,
  cost_guard_thresholds_json TEXT,
  disabled_features_json TEXT,
  cost_guard_reason TEXT,
  cost_guard_updated_by_user_id TEXT,
  cost_guard_updated_at INTEGER,
  cost_guard_exception_until INTEGER,
  cost_guard_exception_features_json TEXT
);

INSERT INTO system_settings_new SELECT
  id, default_editable_fields, upcoming_editable_fields, history_retention_days,
  COALESCE(NULLIF(trim(operation_mode), ''), 'normal'),
  auto_cost_guard_enabled, cost_guard_thresholds_json, disabled_features_json,
  cost_guard_reason, cost_guard_updated_by_user_id, cost_guard_updated_at,
  cost_guard_exception_until, cost_guard_exception_features_json
FROM system_settings;

DROP TABLE system_settings;
ALTER TABLE system_settings_new RENAME TO system_settings;
