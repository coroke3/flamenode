-- 作品投稿時の YouTube チャンネル URL スナップショット (creator_icon_url と同様)

ALTER TABLE `videos` ADD `creator_youtube_channel_url` text;
--> statement-breakpoint

UPDATE `videos`
SET `creator_youtube_channel_url` = (
  SELECT c.`youtube_channel_url`
  FROM `x_user_youtube_channels` c
  WHERE c.`source_video_id` = `videos`.`id`
  ORDER BY c.`created_at` DESC
  LIMIT 1
)
WHERE `creator_youtube_channel_url` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `x_user_youtube_channels` c
    WHERE c.`source_video_id` = `videos`.`id`
  );
