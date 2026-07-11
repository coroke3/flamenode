-- video_collaborators を廃止し、video_members に共同編集権限を統合する第1段階。
-- 第2段階で video_collaborators を DROP する予定だが、本 migration では残置する。
--
-- 1) video_members に権限カラムを追加
-- 2) 既存 video_collaborators の行を video_members にコピー
--    - 同じ (video_id, x_user_id) が既に video_members に存在すれば UPDATE
--    - 存在しなければ INSERT (is_public_member=0 の非公開編集者として)
-- 3) video_collaborators テーブルは残置 (アプリ側で参照しない)

-- 1) カラム追加
ALTER TABLE video_members ADD COLUMN discord_user_id TEXT;
--> statement-breakpoint
ALTER TABLE video_members ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE video_members ADD COLUMN is_public_member INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE video_members ADD COLUMN edit_granted_by_user_id TEXT;
--> statement-breakpoint
ALTER TABLE video_members ADD COLUMN edit_granted_at INTEGER;
--> statement-breakpoint
ALTER TABLE video_members ADD COLUMN edit_updated_at INTEGER;
--> statement-breakpoint

-- 2-a) 既存マッチ: x_user_id 一致のとき can_edit / discord_user_id / 監査タイムスタンプを反映
UPDATE video_members
SET
  can_edit = 1,
  discord_user_id = COALESCE(
    video_members.discord_user_id,
    (SELECT vc.discord_user_id FROM video_collaborators vc
       WHERE vc.video_id = video_members.video_id
         AND vc.x_user_id IS NOT NULL
         AND lower(vc.x_user_id) = lower(video_members.x_user_id)
         AND vc.can_edit = 1
       LIMIT 1)
  ),
  edit_granted_by_user_id = (
    SELECT vc.granted_by_user_id FROM video_collaborators vc
      WHERE vc.video_id = video_members.video_id
        AND vc.x_user_id IS NOT NULL
        AND lower(vc.x_user_id) = lower(video_members.x_user_id)
        AND vc.can_edit = 1
      LIMIT 1
  ),
  edit_granted_at = (
    SELECT vc.created_at FROM video_collaborators vc
      WHERE vc.video_id = video_members.video_id
        AND vc.x_user_id IS NOT NULL
        AND lower(vc.x_user_id) = lower(video_members.x_user_id)
        AND vc.can_edit = 1
      LIMIT 1
  ),
  edit_updated_at = (
    SELECT vc.updated_at FROM video_collaborators vc
      WHERE vc.video_id = video_members.video_id
        AND vc.x_user_id IS NOT NULL
        AND lower(vc.x_user_id) = lower(video_members.x_user_id)
        AND vc.can_edit = 1
      LIMIT 1
  )
WHERE
  video_members.x_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM video_collaborators vc
      WHERE vc.video_id = video_members.video_id
        AND vc.x_user_id IS NOT NULL
        AND lower(vc.x_user_id) = lower(video_members.x_user_id)
        AND vc.can_edit = 1
  );
--> statement-breakpoint

-- 2-b) 既存マッチなし: video_collaborators だけに存在する行を非公開編集者として追加
-- ID は VC 由来であることが判るよう "vm_from_vc_<vc.id>" 形式で固定生成。
INSERT INTO video_members (
  id,
  video_id,
  x_user_id,
  name,
  role,
  comment,
  order_index,
  name_for_sort,
  discord_user_id,
  can_edit,
  is_public_member,
  edit_granted_by_user_id,
  edit_granted_at,
  edit_updated_at
)
SELECT
  'vm_from_vc_' || vc.id,
  vc.video_id,
  vc.x_user_id,
  vc.display_name,
  NULL,
  NULL,
  9999,
  lower(vc.display_name),
  vc.discord_user_id,
  vc.can_edit,
  0,
  vc.granted_by_user_id,
  vc.created_at,
  vc.updated_at
FROM video_collaborators vc
WHERE vc.can_edit = 1
  AND NOT EXISTS (
    SELECT 1 FROM video_members vm
      WHERE vm.video_id = vc.video_id
        AND (
          (vm.x_user_id IS NOT NULL AND vc.x_user_id IS NOT NULL
            AND lower(vm.x_user_id) = lower(vc.x_user_id))
          OR (vm.discord_user_id IS NOT NULL AND vc.discord_user_id IS NOT NULL
            AND vm.discord_user_id = vc.discord_user_id)
        )
  );
--> statement-breakpoint

-- 3) インデックス: video 内で「編集者だけ」を絞り込む頻度が高いので
CREATE INDEX IF NOT EXISTS video_members_video_can_edit_idx
ON video_members (video_id, can_edit);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_members_discord_idx
ON video_members (discord_user_id);
