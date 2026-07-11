-- x_user_icons に (x_user_id, icon_url) の partial unique を入れる。
-- 既存データに同一組合せが残っている可能性があるため、まず重複行のうち
-- created_at が新しい行を残してそれ以外を物理削除する。
-- (history_logs には削除を残さない: 表示用の単純な候補テーブルのため)
DELETE FROM x_user_icons
WHERE id NOT IN (
  SELECT MIN(id)
  FROM x_user_icons
  GROUP BY x_user_id, icon_url
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS x_user_icons_user_url_uniq
ON x_user_icons (x_user_id, icon_url);
