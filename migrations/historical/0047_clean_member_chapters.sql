-- 0047: 本格運用前の破壊的整理 — video_member_chapters を廃止し chapters_json を正本にする。
-- 後方互換なし。

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
  edit_updated_at INTEGER,
  chapters_json TEXT
);

INSERT INTO video_members_new (
  id, video_id, x_user_id, name, role, comment, order_index,
  discord_user_id, can_edit, is_public_member,
  edit_granted_by_user_id, edit_granted_at, edit_updated_at,
  chapters_json
)
SELECT
  vm.id, vm.video_id, vm.x_user_id, vm.name, vm.role, vm.comment, vm.order_index,
  vm.discord_user_id, vm.can_edit, vm.is_public_member,
  vm.edit_granted_by_user_id, vm.edit_granted_at, vm.edit_updated_at,
  (
    SELECT json_group_array(
      json_object(
        'time_seconds', vmc.start_time,
        'label', vmc.label,
        'note', COALESCE(vmc.note, ''),
        'order_index', vmc.sort_order
      )
    )
    FROM video_member_chapters vmc
    WHERE vmc.video_member_id = vm.id
    ORDER BY vmc.sort_order ASC
  )
FROM video_members vm;

DROP TABLE IF EXISTS video_member_chapters;
DROP TABLE video_members;
ALTER TABLE video_members_new RENAME TO video_members;

CREATE INDEX IF NOT EXISTS video_members_video_order_idx ON video_members (video_id, order_index);
CREATE INDEX IF NOT EXISTS video_members_video_name_idx ON video_members (video_id, name);
CREATE INDEX IF NOT EXISTS video_members_video_can_edit_idx ON video_members (video_id, can_edit);
CREATE INDEX IF NOT EXISTS video_members_discord_idx ON video_members (discord_user_id);
