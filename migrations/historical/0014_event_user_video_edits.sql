-- イベント単位で「一般ユーザー (作品オーナー以外) にも作品編集権限を一部委譲できるか」
-- を制御するフラグと、委譲する section_key の JSON 配列を追加する。
--
-- 既定 0 (委譲しない) で、運営が明示的に許可したイベントだけ 1 にする。
-- 危険キー (videos.youtube_id / videos.primary_event / video.identity) は
-- 値に含まれていてもサーバー側で除外する。
ALTER TABLE events ADD COLUMN allow_user_video_edits INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE events ADD COLUMN user_video_edit_permission_keys_json TEXT;
