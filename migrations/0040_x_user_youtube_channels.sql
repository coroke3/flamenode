-- 作品投稿時に使った YouTube チャンネル URL 候補 (x_user_icons と同様)

CREATE TABLE IF NOT EXISTS `x_user_youtube_channels` (
  `id` text PRIMARY KEY NOT NULL,
  `x_user_id` text NOT NULL,
  `youtube_channel_url` text NOT NULL,
  `source_video_id` text,
  `source_type` text NOT NULL DEFAULT 'video',
  `created_at` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `x_user_youtube_channels_user_url_uniq`
ON `x_user_youtube_channels` (`x_user_id`, `youtube_channel_url`);

CREATE INDEX IF NOT EXISTS `x_user_youtube_channels_user_created_idx`
ON `x_user_youtube_channels` (`x_user_id`, `created_at`);

-- 既存: X ID に作品がありプロフィールにチャンネル URL がある行を legacy 候補として1件登録
INSERT OR IGNORE INTO `x_user_youtube_channels` (
  `id`,
  `x_user_id`,
  `youtube_channel_url`,
  `source_video_id`,
  `source_type`,
  `created_at`
)
SELECT
  'xuch_' || lower(hex(randomblob(8))),
  x.`id`,
  x.`youtube_channel_url`,
  (
    SELECT v.`id`
    FROM `videos` v
    WHERE lower(v.`creator_x_user_id`) = lower(x.`id`)
    ORDER BY v.`created_at` DESC
    LIMIT 1
  ),
  'legacy',
  unixepoch()
FROM `x_users` x
WHERE x.`youtube_channel_url` IS NOT NULL
  AND trim(x.`youtube_channel_url`) <> ''
  AND EXISTS (
    SELECT 1
    FROM `videos` v
    WHERE lower(v.`creator_x_user_id`) = lower(x.`id`)
  );
