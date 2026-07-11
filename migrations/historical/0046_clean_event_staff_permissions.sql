-- 0046: 本格運用前の破壊的整理 — permission_mask を廃止。
-- permission_mask → custom_permission_keys_json への移行は instrumentation が先に実行する。
-- 後方互換なし。

CREATE TABLE event_staff_new (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  x_user_id TEXT,
  discord_user_id TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  permission_preset TEXT NOT NULL DEFAULT 'public_staff',
  custom_permission_keys_json TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  public_role_label TEXT,
  internal_note TEXT,
  approved_by_user_id TEXT,
  approved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO event_staff_new (
  id, event_id, x_user_id, discord_user_id, display_name, role,
  permission_preset, custom_permission_keys_json,
  is_public, public_role_label, internal_note,
  approved_by_user_id, approved_at, created_at, updated_at
)
SELECT
  id, event_id, x_user_id, discord_user_id, display_name, role,
  permission_preset, custom_permission_keys_json,
  is_public, public_role_label, internal_note,
  approved_by_user_id, approved_at, created_at, updated_at
FROM event_staff;

DROP TABLE event_staff;
ALTER TABLE event_staff_new RENAME TO event_staff;

CREATE UNIQUE INDEX IF NOT EXISTS event_staff_event_x_uniq
  ON event_staff (event_id, x_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS event_staff_event_discord_uniq
  ON event_staff (event_id, discord_user_id);
CREATE INDEX IF NOT EXISTS event_staff_event_idx ON event_staff (event_id);
CREATE INDEX IF NOT EXISTS event_staff_public_idx
  ON event_staff (event_id, is_public, display_name);
