-- 合作メンバーへのチャプター紐付け列を追加する。
-- NULL = 通常のチャプター / チャプターコメント。値あり = video_members.id への参照。
-- 動画詳細ページの MemberSection (担当チャプター表示) で利用する。
ALTER TABLE video_chapters ADD COLUMN video_member_id TEXT;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_chapters_video_member_idx
ON video_chapters (video_member_id);
