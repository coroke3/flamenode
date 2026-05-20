-- 作品単位の参加者編集権限テーブル。
-- 主となるユーザー (作者) が合作メンバーに section 別の編集権限を付与できる。
-- permission_key は VideoEditSectionKey と整合 (video.basics / video.credits /
-- video.descriptions / video.members / video.youtube_id)。
-- x_user_id / discord_user_id どちらも nullable で、X ID 未連携のメンバーに
-- 先付与しておくユースケースも許容する。
CREATE TABLE IF NOT EXISTS video_collaborator_permissions (
  id text PRIMARY KEY NOT NULL,
  video_id text NOT NULL,
  x_user_id text,
  discord_user_id text,
  display_name text NOT NULL,
  permission_key text NOT NULL,
  allowed integer NOT NULL DEFAULT 1,
  granted_by_user_id text NOT NULL,
  created_at integer NOT NULL DEFAULT (unixepoch()),
  updated_at integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

-- 主体 (x_user_id または discord_user_id) ごとに同じ video_id × permission_key の
-- 重複を防ぐ部分 unique index。一つの subject に対しては「allowed か否か」を
-- 1 行で保持する。
CREATE UNIQUE INDEX IF NOT EXISTS vid_collab_perm_x_uniq
ON video_collaborator_permissions (video_id, x_user_id, permission_key)
WHERE x_user_id IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS vid_collab_perm_discord_uniq
ON video_collaborator_permissions (video_id, discord_user_id, permission_key)
WHERE discord_user_id IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS vid_collab_perm_video_idx
ON video_collaborator_permissions (video_id);
