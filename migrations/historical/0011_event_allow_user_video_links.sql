-- 一般ユーザー (作品投稿者) が既存作品の追加イベント所属を選択できるかを
-- イベントごとに制御するフラグを追加する。
--   - allow_user_video_event_links = 0 (既定): 不許可。
--     イベント運営・管理者のみ video_events を追加できる。
--   - 1: 許可。作品投稿者の VideoForm 上で「所属イベント」候補として選択可。
ALTER TABLE events
ADD COLUMN allow_user_video_event_links integer NOT NULL DEFAULT 0;
