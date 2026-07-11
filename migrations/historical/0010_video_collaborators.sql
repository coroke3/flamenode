-- 仕様変更: 作品単位の合作メンバー編集権限を「細粒度 5 キー」から
-- 「編集権限あり / なし」のシンプル ON/OFF に変更する。
--
-- 旧 video_collaborator_permissions (migration 0009 で追加) は
-- permission_key 列を持っていたが、合作メンバー向けは粒度が過剰だった。
-- 新 video_collaborators は can_edit boolean のみで、編集可能範囲は
-- そのユーザーが持つ全体権限・イベント編集権限・作品の creator 一致に従う。
--
-- 旧テーブルは UI / Action / canEditVideo 判定すべてを新テーブルに切り替えた後で
-- DROP する。本番に同テーブルへの実データが入っている場合は別途データ移行が
-- 必要だが、0009 は適用直後で実運用データはないため安全に drop する。
CREATE TABLE IF NOT EXISTS video_collaborators (
  id text PRIMARY KEY NOT NULL,
  video_id text NOT NULL,
  x_user_id text,
  discord_user_id text,
  display_name text NOT NULL,
  can_edit integer NOT NULL DEFAULT 1,
  granted_by_user_id text NOT NULL,
  created_at integer NOT NULL DEFAULT (unixepoch()),
  updated_at integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

-- 同じ video × subject の重複登録防止 (X ID / Discord ID それぞれの部分 unique)
CREATE UNIQUE INDEX IF NOT EXISTS video_collaborators_x_uniq
ON video_collaborators (video_id, x_user_id)
WHERE x_user_id IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS video_collaborators_discord_uniq
ON video_collaborators (video_id, discord_user_id)
WHERE discord_user_id IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_collaborators_video_idx
ON video_collaborators (video_id);
--> statement-breakpoint

-- 旧テーブルを破棄する (0009 で追加直後の状態前提、実運用データは存在しない想定)
DROP TABLE IF EXISTS video_collaborator_permissions;
