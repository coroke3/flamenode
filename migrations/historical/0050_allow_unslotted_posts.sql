-- 枠なし投稿時に一般ユーザーが作品をこのイベントへ紐づけできるか。
--   0 = 不許可 (既定)
--   1 = 許可 (/entry/unslotted の所属イベント候補に表示)
ALTER TABLE events
ADD COLUMN allow_unslotted_posts integer NOT NULL DEFAULT 0;
