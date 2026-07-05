-- 作品主体 (creator_x_user_id) と候補行の x_user_id を揃える (active X 誤記録の修復)

UPDATE `x_user_youtube_channels`
SET `x_user_id` = (
  SELECT v.`creator_x_user_id`
  FROM `videos` v
  WHERE v.`id` = `x_user_youtube_channels`.`source_video_id`
)
WHERE `source_video_id` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `videos` v
    WHERE v.`id` = `x_user_youtube_channels`.`source_video_id`
      AND v.`creator_x_user_id` IS NOT NULL
      AND trim(v.`creator_x_user_id`) <> ''
      AND lower(v.`creator_x_user_id`) <> lower(`x_user_youtube_channels`.`x_user_id`)
  );
