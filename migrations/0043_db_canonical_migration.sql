-- Migration: 0043_db_canonical_migration.sql
-- Date: 2026-07-20
-- Type: destructive
-- Summary: X名義・申請・イベント権限・作品関連・監査設定を修正後DB正本へ移行し旧構造を削除する。
-- Data loss: intentional
-- Rollback: 適用前のD1バックアップを復元し、0043適用前のアプリケーションへ戻す。
-- Change log: docs/database/change-log.md
PRAGMA foreign_keys = OFF;
INSERT OR IGNORE INTO "user" (
  id, name, role, can_create_events, is_notification_enabled, created_at
) VALUES (
  'system_db_migration', 'DB migration system', 'user', 0, 0, unixepoch()
);
INSERT OR IGNORE INTO x_users (id, x_name, approval_status)
SELECT DISTINCT x_id, x_id, 'pending'
FROM (
  SELECT x_user_id AS x_id FROM event_staff WHERE x_user_id IS NOT NULL AND trim(x_user_id) <> ''
  UNION ALL
  SELECT x_user_id FROM video_members WHERE x_user_id IS NOT NULL AND trim(x_user_id) <> ''
  UNION ALL
  SELECT x_user_id FROM video_chapters WHERE x_user_id IS NOT NULL AND trim(x_user_id) <> ''
  UNION ALL
  SELECT representative_x_user_id FROM events WHERE representative_x_user_id IS NOT NULL AND trim(representative_x_user_id) <> ''
  UNION ALL
  SELECT requested_x_id FROM x_account_link_requests WHERE requested_x_id IS NOT NULL AND trim(requested_x_id) <> ''
  UNION ALL
  SELECT target_x_user_id FROM x_account_link_requests WHERE target_x_user_id IS NOT NULL AND trim(target_x_user_id) <> ''
  UNION ALL
  SELECT from_x_user_id FROM x_id_merge_requests WHERE from_x_user_id IS NOT NULL AND trim(from_x_user_id) <> ''
  UNION ALL
  SELECT to_x_user_id FROM x_id_merge_requests WHERE to_x_user_id IS NOT NULL AND trim(to_x_user_id) <> ''
) refs
WHERE x_id IS NOT NULL AND trim(x_id) <> '';
INSERT OR IGNORE INTO x_users (id, x_name, approval_status)
SELECT
  'legacy_auth:' || u.id,
  COALESCE(NULLIF(trim(u.name), ''), 'Legacy user'),
  'pending'
FROM "user" u
WHERE EXISTS (
  SELECT 1 FROM event_staff es WHERE es.user_id = u.id AND es.x_user_id IS NULL
  UNION ALL
  SELECT 1 FROM video_members vm WHERE vm.user_id = u.id AND vm.x_user_id IS NULL
);
UPDATE videos
SET youtube_video_id = (
  SELECT m.youtube_video_id
  FROM video_youtube_metadata m
  WHERE m.video_id = videos.id
)
WHERE (youtube_video_id IS NULL OR trim(youtube_video_id) = '')
  AND EXISTS (
    SELECT 1 FROM video_youtube_metadata m
    WHERE m.video_id = videos.id
      AND m.youtube_video_id IS NOT NULL
      AND trim(m.youtube_video_id) <> ''
  );
CREATE TABLE x_identity_requests (
  id TEXT PRIMARY KEY NOT NULL,
  request_type TEXT NOT NULL,
  requested_by_auth_user_id TEXT NOT NULL,
  requested_x_id TEXT,
  source_x_user_id TEXT,
  target_x_user_id TEXT,
  parent_request_id TEXT,
  restore_snapshot_json TEXT,
  revert_deadline_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT x_identity_requests_shape_check CHECK (
    (request_type IN ('new_link', 'existing_link', 'alias') AND requested_x_id IS NOT NULL)
    OR (request_type = 'merge' AND source_x_user_id IS NOT NULL AND target_x_user_id IS NOT NULL AND source_x_user_id <> target_x_user_id)
    OR (request_type = 'revert_merge' AND parent_request_id IS NOT NULL)
  ),
  FOREIGN KEY (requested_by_auth_user_id) REFERENCES "user"(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_x_user_id) REFERENCES x_users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_x_user_id) REFERENCES x_users(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_request_id) REFERENCES x_identity_requests(id) ON DELETE SET NULL
);
CREATE INDEX x_identity_requests_requested_by_idx
  ON x_identity_requests (requested_by_auth_user_id, status, requested_at);
CREATE INDEX x_identity_requests_target_idx
  ON x_identity_requests (target_x_user_id, status);
CREATE INDEX x_identity_requests_source_idx
  ON x_identity_requests (source_x_user_id, status);
CREATE INDEX x_identity_requests_parent_idx
  ON x_identity_requests (parent_request_id);
INSERT INTO x_identity_requests (
  id, request_type, requested_by_auth_user_id, requested_x_id,
  source_x_user_id, target_x_user_id, parent_request_id,
  restore_snapshot_json, revert_deadline_at, status, requested_at, updated_at
)
SELECT
  'link:' || id,
  CASE link_type
    WHEN 'new' THEN 'new_link'
    WHEN 'alias' THEN 'alias'
    ELSE 'existing_link'
  END,
  user_id,
  requested_x_id,
  NULL,
  target_x_user_id,
  NULL,
  NULL,
  NULL,
  COALESCE(status, 'pending'),
  requested_at,
  requested_at
FROM x_account_link_requests;
INSERT INTO x_identity_requests (
  id, request_type, requested_by_auth_user_id, requested_x_id,
  source_x_user_id, target_x_user_id, parent_request_id,
  restore_snapshot_json, revert_deadline_at, status, requested_at, updated_at
)
SELECT
  'merge:' || id,
  'merge',
  requested_by_user_id,
  NULL,
  from_x_user_id,
  to_x_user_id,
  NULL,
  NULL,
  NULL,
  COALESCE(status, 'pending'),
  created_at,
  updated_at
FROM x_id_merge_requests;
INSERT INTO x_identity_requests (
  id, request_type, requested_by_auth_user_id, requested_x_id,
  source_x_user_id, target_x_user_id, parent_request_id,
  restore_snapshot_json, revert_deadline_at, status, requested_at, updated_at
)
SELECT
  'revert:' || id,
  'revert_merge',
  requested_by_user_id,
  NULL,
  NULL,
  NULL,
  'merge:' || merge_request_id,
  restore_snapshot_json,
  revert_deadline_at,
  COALESCE(status, 'pending'),
  created_at,
  updated_at
FROM x_id_merge_reverts;
CREATE TABLE x_user_account_links (
  x_user_id TEXT NOT NULL,
  auth_user_id TEXT NOT NULL,
  link_role TEXT NOT NULL DEFAULT 'owner',
  created_by_request_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (x_user_id, auth_user_id),
  FOREIGN KEY (x_user_id) REFERENCES x_users(id) ON DELETE CASCADE,
  FOREIGN KEY (auth_user_id) REFERENCES "user"(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_request_id) REFERENCES x_identity_requests(id) ON DELETE SET NULL
);
CREATE INDEX x_user_account_links_auth_user_idx
  ON x_user_account_links (auth_user_id, link_role, x_user_id);
CREATE INDEX x_user_account_links_x_user_idx
  ON x_user_account_links (x_user_id, link_role, auth_user_id);
INSERT OR IGNORE INTO x_user_account_links (
  x_user_id, auth_user_id, link_role, created_by_request_id, created_at, updated_at
)
SELECT id, linked_user_id, 'owner', NULL, unixepoch(), unixepoch()
FROM x_users
WHERE linked_user_id IS NOT NULL;
INSERT OR IGNORE INTO x_user_account_links (
  x_user_id, auth_user_id, link_role, created_by_request_id, created_at, updated_at
)
SELECT COALESCE(x_user_id, 'legacy_auth:' || user_id), user_id, 'manager', NULL,
       COALESCE(created_at, unixepoch()), COALESCE(updated_at, unixepoch())
FROM event_staff
WHERE user_id IS NOT NULL;
INSERT OR IGNORE INTO x_user_account_links (
  x_user_id, auth_user_id, link_role, created_by_request_id, created_at, updated_at
)
SELECT COALESCE(x_user_id, 'legacy_auth:' || user_id), user_id,
       CASE WHEN can_edit = 1 THEN 'manager' ELSE 'owner' END,
       NULL, COALESCE(edit_granted_at, unixepoch()), COALESCE(edit_updated_at, unixepoch())
FROM video_members
WHERE user_id IS NOT NULL;
CREATE TABLE x_users_new (
  id TEXT PRIMARY KEY NOT NULL,
  x_name TEXT NOT NULL,
  icon_url TEXT,
  profile_text TEXT,
  portfolio_contact TEXT,
  youtube_channel_url TEXT,
  other_social_links TEXT,
  creative_start_date INTEGER,
  approval_status TEXT DEFAULT 'pending'
);
INSERT INTO x_users_new (
  id, x_name, icon_url, profile_text, portfolio_contact, youtube_channel_url,
  other_social_links, creative_start_date, approval_status
)
SELECT
  xu.id,
  xu.x_name,
  COALESCE(
    NULLIF(trim(xu.icon_url), ''),
    (SELECT NULLIF(trim(xui.icon_url), '') FROM x_user_icons xui
     WHERE xui.x_user_id = xu.id ORDER BY xui.created_at DESC, xui.id DESC LIMIT 1)
  ),
  xu.profile_text,
  xu.portfolio_contact,
  COALESCE(
    NULLIF(trim(xu.youtube_channel_url), ''),
    (SELECT NULLIF(trim(xyc.youtube_channel_url), '') FROM x_user_youtube_channels xyc
     WHERE xyc.x_user_id = xu.id ORDER BY xyc.created_at DESC, xyc.id DESC LIMIT 1)
  ),
  xu.other_social_links,
  xu.creative_start_date,
  COALESCE(xu.approval_status, 'pending')
FROM x_users xu;
DROP TABLE x_users;
ALTER TABLE x_users_new RENAME TO x_users;
CREATE TABLE event_group_events_new (
  event_group_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (event_group_id, event_id),
  FOREIGN KEY (event_group_id) REFERENCES event_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
INSERT INTO event_group_events_new
  (event_group_id, event_id, relation_type, created_at, updated_at)
SELECT event_group_id, event_id, relation_type, created_at, updated_at
FROM event_group_events;
DROP TABLE event_group_events;
ALTER TABLE event_group_events_new RENAME TO event_group_events;
CREATE INDEX event_group_events_event_idx ON event_group_events (event_id);
CREATE INDEX event_group_events_group_relation_idx
  ON event_group_events (event_group_id, relation_type);
CREATE TABLE events_new (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  event_type TEXT DEFAULT 'event',
  explanation TEXT,
  icon_url TEXT,
  img_url TEXT,
  accent_color TEXT,
  visibility_status TEXT NOT NULL DEFAULT 'draft',
  allow_user_video_event_links INTEGER NOT NULL DEFAULT 0,
  allow_unslotted_posts INTEGER NOT NULL DEFAULT 0,
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
  review_settings TEXT,
  editable_fields TEXT,
  repeat_rules TEXT,
  slot_part_gap_minutes INTEGER DEFAULT 15,
  parts_json TEXT,
  public_api_enabled INTEGER NOT NULL DEFAULT 0
);
INSERT INTO events_new (
  id, title, event_type, explanation, icon_url, img_url, accent_color,
  visibility_status, allow_user_video_event_links, allow_unslotted_posts,
  allow_user_video_edits, user_video_edit_permission_keys_json, slot_type,
  slot_visibility_mode, start_time, end_time, entry_start_time, entry_end_time,
  created_at, updated_at, max_slots_per_video, review_settings, editable_fields,
  repeat_rules, slot_part_gap_minutes, parts_json, public_api_enabled
)
SELECT
  id, title, event_type, explanation, icon_url, img_url, accent_color,
  visibility_status, allow_user_video_event_links, allow_unslotted_posts,
  allow_user_video_edits, user_video_edit_permission_keys_json, slot_type,
  slot_visibility_mode, start_time, end_time, entry_start_time, entry_end_time,
  created_at, updated_at, max_slots_per_video, review_settings, editable_fields,
  repeat_rules, slot_part_gap_minutes, parts_json, public_api_enabled
FROM events;
CREATE TEMP TABLE _migration_event_representatives AS
SELECT id AS event_id, representative_x_user_id
FROM events
WHERE representative_x_user_id IS NOT NULL AND trim(representative_x_user_id) <> '';
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX events_visibility_start_idx
  ON events (visibility_status, start_time);
CREATE TABLE event_staff_new (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  permission_preset TEXT NOT NULL DEFAULT 'public_staff',
  custom_permission_keys_json TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  public_role_label TEXT,
  approved_by_auth_user_id TEXT,
  approved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (x_user_id) REFERENCES x_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_auth_user_id) REFERENCES "user"(id) ON DELETE SET NULL
);
INSERT INTO event_staff_new (
  id, event_id, x_user_id, display_name, permission_preset,
  custom_permission_keys_json, is_public, public_role_label,
  approved_by_auth_user_id, approved_at, created_at, updated_at
)
SELECT
  es.id,
  es.event_id,
  COALESCE(es.x_user_id, 'legacy_auth:' || es.user_id),
  es.display_name,
  CASE
    WHEN es.permission_preset = 'owner' THEN 'owner'
    WHEN es.role = 'representative' THEN 'owner'
    WHEN EXISTS (
      SELECT 1 FROM _migration_event_representatives r
      WHERE r.event_id = es.event_id
        AND r.representative_x_user_id = COALESCE(es.x_user_id, 'legacy_auth:' || es.user_id)
    ) THEN 'owner'
    ELSE COALESCE(es.permission_preset, 'public_staff')
  END,
  es.custom_permission_keys_json,
  es.is_public,
  COALESCE(es.public_role_label,
    CASE es.role WHEN 'representative' THEN '代表' WHEN 'editor' THEN '編集' ELSE NULL END),
  es.approved_by_user_id,
  es.approved_at,
  es.created_at,
  es.updated_at
FROM event_staff es
WHERE COALESCE(es.x_user_id, CASE WHEN es.user_id IS NOT NULL THEN 'legacy_auth:' || es.user_id END) IS NOT NULL;
INSERT INTO event_staff_new (
  id, event_id, x_user_id, display_name, permission_preset,
  custom_permission_keys_json, is_public, public_role_label,
  approved_by_auth_user_id, approved_at, created_at, updated_at
)
SELECT
  'owner:' || r.event_id || ':' || r.representative_x_user_id,
  r.event_id,
  r.representative_x_user_id,
  COALESCE(NULLIF(trim(xu.x_name), ''), r.representative_x_user_id),
  'owner', NULL, 1, '代表', NULL, NULL, unixepoch(), unixepoch()
FROM _migration_event_representatives r
JOIN x_users xu ON xu.id = r.representative_x_user_id
WHERE NOT EXISTS (
  SELECT 1 FROM event_staff_new es
  WHERE es.event_id = r.event_id AND es.permission_preset = 'owner'
);
INSERT OR IGNORE INTO x_users (id, x_name, approval_status)
SELECT 'legacy_event_owner:' || e.id, e.title || ' 運営', 'pending'
FROM events e
WHERE NOT EXISTS (
  SELECT 1 FROM event_staff_new es WHERE es.event_id = e.id
);
INSERT INTO event_staff_new (
  id, event_id, x_user_id, display_name, permission_preset,
  custom_permission_keys_json, is_public, public_role_label,
  approved_by_auth_user_id, approved_at, created_at, updated_at
)
SELECT
  'owner:' || e.id,
  e.id,
  'legacy_event_owner:' || e.id,
  e.title || ' 運営',
  'owner', NULL, 0, '代表', NULL, NULL, unixepoch(), unixepoch()
FROM events e
WHERE NOT EXISTS (
  SELECT 1 FROM event_staff_new es WHERE es.event_id = e.id
);
UPDATE event_staff_new
SET permission_preset = 'owner'
WHERE id IN (
  SELECT (
    SELECT es.id FROM event_staff_new es
    WHERE es.event_id = e.id
    ORDER BY es.created_at ASC, es.id ASC
    LIMIT 1
  )
  FROM events e
  WHERE NOT EXISTS (
    SELECT 1 FROM event_staff_new owner
    WHERE owner.event_id = e.id AND owner.permission_preset = 'owner'
  )
);
DROP TABLE event_staff;
ALTER TABLE event_staff_new RENAME TO event_staff;
CREATE UNIQUE INDEX event_staff_event_x_uniq ON event_staff (event_id, x_user_id);
CREATE INDEX event_staff_event_idx ON event_staff (event_id);
CREATE INDEX event_staff_event_preset_idx ON event_staff (event_id, permission_preset);
CREATE INDEX event_staff_public_idx ON event_staff (event_id, is_public, display_name);
CREATE TABLE videos_new (
  id TEXT PRIMARY KEY NOT NULL,
  primary_event_id TEXT,
  creator_x_user_id TEXT,
  submitted_by_user_id TEXT NOT NULL,
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
  app_like_count INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  score_updated_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (primary_event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY (creator_x_user_id) REFERENCES x_users(id) ON DELETE SET NULL,
  FOREIGN KEY (submitted_by_user_id) REFERENCES "user"(id) ON DELETE RESTRICT
);
INSERT INTO videos_new SELECT
  id,
  CASE WHEN EXISTS (SELECT 1 FROM events e WHERE e.id = videos.primary_event_id)
       THEN primary_event_id ELSE NULL END,
  creator_x_user_id, submitted_by_user_id, collaboration_type, part, source_type,
  creator_display_name, creator_display_name_yomi, creator_icon_url,
  creator_youtube_channel_url, title, music, credit, music_reference_url,
  closing_comment, youtube_video_id, intro_comment, highlights, production_story,
  visibility_status, scheduling_type, scheduled_time, app_like_count, score,
  score_updated_at, created_at, updated_at
FROM videos;
DROP TABLE videos;
ALTER TABLE videos_new RENAME TO videos;
CREATE INDEX videos_visibility_status_idx ON videos (visibility_status);
CREATE INDEX videos_scheduled_idx ON videos (scheduled_time);
CREATE INDEX videos_primary_event_idx ON videos (primary_event_id);
CREATE INDEX videos_submitted_by_idx ON videos (submitted_by_user_id);
CREATE INDEX videos_creator_x_idx ON videos (creator_x_user_id);
CREATE INDEX videos_youtube_id_idx ON videos (youtube_video_id);
CREATE INDEX videos_public_scheduled_idx ON videos (visibility_status, scheduled_time);
CREATE INDEX videos_public_score_idx ON videos (visibility_status, score, scheduled_time);
CREATE INDEX videos_score_refresh_idx ON videos (visibility_status, score_updated_at, id);
CREATE INDEX videos_creator_public_idx
  ON videos (creator_x_user_id, visibility_status, primary_event_id, id);
CREATE INDEX videos_creator_fallback_idx
  ON videos (creator_x_user_id, collaboration_type, created_at)
  WHERE creator_x_user_id IS NOT NULL
    AND visibility_status NOT IN ('archived', 'voided')
    AND (creator_icon_url IS NOT NULL OR creator_display_name IS NOT NULL);
CREATE UNIQUE INDEX videos_youtube_id_active_uniq ON videos (youtube_video_id)
  WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> ''
    AND visibility_status NOT IN ('archived', 'voided');
CREATE TABLE slots_new (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  reserved_by_user_id TEXT,
  x_user_id TEXT,
  display_name TEXT,
  slot_label TEXT,
  start_time INTEGER,
  sort_order INTEGER DEFAULT 0,
  reservation_group_id TEXT,
  video_id TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (reserved_by_user_id) REFERENCES "user"(id) ON DELETE SET NULL,
  FOREIGN KEY (x_user_id) REFERENCES x_users(id) ON DELETE SET NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE SET NULL
);
INSERT INTO slots_new (
  id, event_id, reserved_by_user_id, x_user_id, display_name, slot_label,
  start_time, sort_order, reservation_group_id, video_id, status, updated_at, version
)
SELECT id, event_id, reserved_by_user_id, x_user_id, display_name, slot_label,
       start_time, sort_order, reservation_group_id, video_id, status, updated_at, version
FROM slots;
DROP TABLE slots;
ALTER TABLE slots_new RENAME TO slots;
CREATE INDEX slots_event_idx ON slots (event_id, start_time);
CREATE INDEX slots_video_idx ON slots (video_id);
CREATE INDEX slots_reservation_group_idx ON slots (reservation_group_id);
CREATE TABLE video_youtube_metadata_new (
  video_id TEXT PRIMARY KEY NOT NULL,
  youtube_privacy_status TEXT,
  youtube_availability_status TEXT,
  duration_seconds INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
INSERT INTO video_youtube_metadata_new (
  video_id, youtube_privacy_status, youtube_availability_status,
  duration_seconds, view_count, synced_at, sync_status, sync_error, updated_at
)
SELECT video_id, youtube_privacy_status, youtube_availability_status,
       duration_seconds, view_count, synced_at, sync_status, sync_error, updated_at
FROM video_youtube_metadata
WHERE EXISTS (SELECT 1 FROM videos v WHERE v.id = video_youtube_metadata.video_id);
DROP TABLE video_youtube_metadata;
ALTER TABLE video_youtube_metadata_new RENAME TO video_youtube_metadata;
CREATE INDEX video_youtube_metadata_sync_idx
  ON video_youtube_metadata (sync_status, synced_at);
CREATE TEMP TABLE _migration_video_members_source AS SELECT * FROM video_members;
CREATE TABLE video_members_new (
  id TEXT PRIMARY KEY NOT NULL,
  video_id TEXT NOT NULL,
  x_user_id TEXT,
  name TEXT NOT NULL,
  role TEXT,
  comment TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  can_edit INTEGER NOT NULL DEFAULT 0,
  is_public_member INTEGER NOT NULL DEFAULT 1,
  edit_granted_by_auth_user_id TEXT,
  edit_granted_at INTEGER,
  edit_updated_at INTEGER,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (x_user_id) REFERENCES x_users(id) ON DELETE SET NULL,
  FOREIGN KEY (edit_granted_by_auth_user_id) REFERENCES "user"(id) ON DELETE SET NULL
);
INSERT INTO video_members_new (
  id, video_id, x_user_id, name, role, comment, order_index, can_edit,
  is_public_member, edit_granted_by_auth_user_id, edit_granted_at, edit_updated_at
)
SELECT id, video_id, COALESCE(x_user_id, CASE WHEN user_id IS NOT NULL THEN 'legacy_auth:' || user_id END),
       name, role, comment, order_index, can_edit, is_public_member,
       edit_granted_by_user_id, edit_granted_at, edit_updated_at
FROM video_members
WHERE EXISTS (SELECT 1 FROM videos v WHERE v.id = video_members.video_id);
DROP TABLE video_members;
ALTER TABLE video_members_new RENAME TO video_members;
CREATE INDEX video_members_video_order_idx ON video_members (video_id, order_index);
CREATE INDEX video_members_video_name_idx ON video_members (video_id, name);
CREATE INDEX video_members_video_can_edit_idx ON video_members (video_id, can_edit);
CREATE INDEX video_members_x_user_video_idx ON video_members (x_user_id, video_id);
CREATE TABLE video_chapters_new (
  id TEXT PRIMARY KEY NOT NULL,
  video_id TEXT NOT NULL,
  x_user_id TEXT,
  chapter_time REAL NOT NULL,
  chapter_label TEXT NOT NULL,
  note TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (x_user_id) REFERENCES x_users(id) ON DELETE SET NULL
);
INSERT INTO video_chapters_new (
  id, video_id, x_user_id, chapter_time, chapter_label, note, visibility, created_at, updated_at
)
SELECT id, video_id, x_user_id, chapter_time, chapter_label, note,
       COALESCE(visibility, 'public'), created_at, updated_at
FROM video_chapters
WHERE EXISTS (SELECT 1 FROM videos v WHERE v.id = video_chapters.video_id);
INSERT INTO video_chapters_new (
  id, video_id, x_user_id, chapter_time, chapter_label, note, visibility, created_at, updated_at
)
SELECT
  vm.id || ':legacy:' || CAST(je.key AS TEXT),
  vm.video_id,
  vm.x_user_id,
  COALESCE(
    CAST(json_extract(je.value, '$.time_seconds') AS REAL),
    CAST(json_extract(je.value, '$.time') AS REAL),
    CAST(json_extract(je.value, '$.chapter_time') AS REAL),
    0
  ),
  COALESCE(
    NULLIF(trim(CAST(json_extract(je.value, '$.label') AS TEXT)), ''),
    NULLIF(trim(CAST(json_extract(je.value, '$.chapter_label') AS TEXT)), ''),
    '担当'
  ),
  NULLIF(trim(CAST(json_extract(je.value, '$.note') AS TEXT)), ''),
  'public',
  unixepoch(),
  unixepoch()
FROM _migration_video_members_source vm
JOIN json_each(vm.chapters_json) je
WHERE vm.chapters_json IS NOT NULL
  AND trim(vm.chapters_json) <> ''
  AND json_valid(vm.chapters_json) = 1
  AND NOT EXISTS (
    SELECT 1 FROM video_chapters_new vc
    WHERE vc.video_id = vm.video_id
      AND COALESCE(vc.x_user_id, '') = COALESCE(vm.x_user_id, '')
      AND vc.chapter_time = COALESCE(
        CAST(json_extract(je.value, '$.time_seconds') AS REAL),
        CAST(json_extract(je.value, '$.time') AS REAL),
        CAST(json_extract(je.value, '$.chapter_time') AS REAL),
        0
      )
      AND vc.chapter_label = COALESCE(
        NULLIF(trim(CAST(json_extract(je.value, '$.label') AS TEXT)), ''),
        NULLIF(trim(CAST(json_extract(je.value, '$.chapter_label') AS TEXT)), ''),
        '担当'
      )
  );
DROP TABLE video_chapters;
ALTER TABLE video_chapters_new RENAME TO video_chapters;
CREATE INDEX video_chapters_video_time_idx ON video_chapters (video_id, chapter_time);
CREATE INDEX video_chapters_video_visibility_idx
  ON video_chapters (video_id, visibility, chapter_time);
CREATE TABLE video_softwares_new (
  video_id TEXT NOT NULL,
  software_id TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  PRIMARY KEY (video_id, software_id),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (software_id) REFERENCES software_catalog(id) ON DELETE RESTRICT
);
INSERT INTO video_softwares_new (video_id, software_id, raw_label)
SELECT video_id, software_id, raw_label
FROM video_softwares
WHERE EXISTS (SELECT 1 FROM videos v WHERE v.id = video_softwares.video_id)
  AND EXISTS (SELECT 1 FROM software_catalog s WHERE s.id = video_softwares.software_id);
DROP TABLE video_softwares;
ALTER TABLE video_softwares_new RENAME TO video_softwares;
CREATE INDEX video_softwares_software_video_idx
  ON video_softwares (software_id, video_id);
CREATE TABLE video_interactions_new (
  x_user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (x_user_id, video_id, interaction_type),
  FOREIGN KEY (x_user_id) REFERENCES x_users(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO video_interactions_new
  (x_user_id, video_id, interaction_type, created_at)
SELECT x_user_id, video_id, interaction_type, created_at
FROM video_interactions
WHERE COALESCE(source, 'app') = 'app'
  AND EXISTS (SELECT 1 FROM x_users xu WHERE xu.id = video_interactions.x_user_id)
  AND EXISTS (SELECT 1 FROM videos v WHERE v.id = video_interactions.video_id);
DROP TABLE video_interactions;
ALTER TABLE video_interactions_new RENAME TO video_interactions;
CREATE INDEX video_interactions_video_type_idx
  ON video_interactions (video_id, interaction_type, created_at);
CREATE TABLE system_settings_new (
  id TEXT PRIMARY KEY NOT NULL,
  default_editable_fields TEXT,
  upcoming_editable_fields TEXT,
  operation_mode TEXT DEFAULT 'normal',
  disabled_features_json TEXT,
  cost_guard_reason TEXT,
  cost_guard_updated_by_user_id TEXT,
  cost_guard_updated_at INTEGER,
  cost_guard_exception_until INTEGER,
  cost_guard_exception_features_json TEXT,
  audit_normal_retention_days INTEGER NOT NULL DEFAULT 30,
  audit_restorable_retention_days INTEGER NOT NULL DEFAULT 180,
  audit_long_retention_days INTEGER NOT NULL DEFAULT 365,
  audit_max_payload_bytes INTEGER NOT NULL DEFAULT 120000,
  audit_compact_after_days INTEGER NOT NULL DEFAULT 30,
  audit_updated_by_auth_user_id TEXT,
  audit_updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (cost_guard_updated_by_user_id) REFERENCES "user"(id) ON DELETE SET NULL,
  FOREIGN KEY (audit_updated_by_auth_user_id) REFERENCES "user"(id) ON DELETE SET NULL
);
INSERT INTO system_settings_new (
  id, default_editable_fields, upcoming_editable_fields, operation_mode,
  disabled_features_json, cost_guard_reason, cost_guard_updated_by_user_id,
  cost_guard_updated_at, cost_guard_exception_until,
  cost_guard_exception_features_json, audit_normal_retention_days,
  audit_restorable_retention_days, audit_long_retention_days,
  audit_max_payload_bytes, audit_compact_after_days,
  audit_updated_by_auth_user_id, audit_updated_at
)
SELECT
  ss.id,
  ss.default_editable_fields,
  ss.upcoming_editable_fields,
  COALESCE(ss.operation_mode, 'normal'),
  ss.disabled_features_json,
  ss.cost_guard_reason,
  ss.cost_guard_updated_by_user_id,
  ss.cost_guard_updated_at,
  ss.cost_guard_exception_until,
  ss.cost_guard_exception_features_json,
  COALESCE(als.normal_retention_days, ss.history_retention_days, 30),
  COALESCE(als.restorable_retention_days, 180),
  COALESCE(als.long_audit_retention_days, 365),
  COALESCE(als.max_payload_bytes, 120000),
  COALESCE(als.compact_after_days, 30),
  als.updated_by_user_id,
  COALESCE(als.updated_at, unixepoch())
FROM system_settings ss
LEFT JOIN audit_log_settings als ON als.id = 'default';
INSERT INTO system_settings_new (
  id, operation_mode, audit_normal_retention_days,
  audit_restorable_retention_days, audit_long_retention_days,
  audit_max_payload_bytes, audit_compact_after_days,
  audit_updated_by_auth_user_id, audit_updated_at
)
SELECT
  'default', 'normal', normal_retention_days, restorable_retention_days,
  long_audit_retention_days, max_payload_bytes, compact_after_days,
  updated_by_user_id, updated_at
FROM audit_log_settings
WHERE id = 'default'
  AND NOT EXISTS (SELECT 1 FROM system_settings_new);
INSERT INTO system_settings_new (id)
SELECT 'default'
WHERE NOT EXISTS (SELECT 1 FROM system_settings_new);
DROP TABLE system_settings;
ALTER TABLE system_settings_new RENAME TO system_settings;
CREATE INDEX system_settings_operation_mode_idx ON system_settings (operation_mode);
CREATE TABLE software_aliases_new (
  software_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  PRIMARY KEY (software_id, normalized_alias),
  FOREIGN KEY (software_id) REFERENCES software_catalog(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO software_aliases_new (software_id, alias, normalized_alias)
SELECT software_id, alias, normalized_alias
FROM software_aliases
WHERE EXISTS (SELECT 1 FROM software_catalog s WHERE s.id = software_aliases.software_id);
DROP TABLE software_aliases;
ALTER TABLE software_aliases_new RENAME TO software_aliases;
CREATE UNIQUE INDEX software_aliases_global_alias_uniq
  ON software_aliases (normalized_alias);
DROP TABLE audit_log_settings;
DROP TABLE legacy_import_batch_items;
DROP TABLE legacy_import_batches;
DROP TABLE x_account_link_requests;
DROP TABLE x_id_merge_reverts;
DROP TABLE x_id_merge_requests;
DROP TABLE x_user_icons;
DROP TABLE x_user_youtube_channels;
DROP TABLE _migration_event_representatives;
DROP TABLE _migration_video_members_source;
UPDATE flamenode_schema_meta
SET version = '2026-07-20-canonical-1', applied_at = unixepoch()
WHERE id = 'current';
INSERT INTO flamenode_schema_meta (id, version, applied_at)
SELECT 'current', '2026-07-20-canonical-1', unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM flamenode_schema_meta WHERE id = 'current');
CREATE TEMP TABLE _migration_owner_assert (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO _migration_owner_assert (ok)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM events e
  WHERE NOT EXISTS (
    SELECT 1 FROM event_staff es
    WHERE es.event_id = e.id AND es.permission_preset = 'owner'
  )
) THEN 1 ELSE 0 END;
DROP TABLE _migration_owner_assert;
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
