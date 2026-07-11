-- 0037: Backfill normalized stage-permission answers from videos.stage_permission.
-- videos.stage_permission is kept as read-only compatibility data. New writes
-- go to video_custom_answers.

WITH video_event_targets AS (
  SELECT `id` AS `video_id`, `primary_event_id` AS `event_id`
  FROM `videos`
  WHERE `primary_event_id` IS NOT NULL
  UNION
  SELECT `video_id`, `event_id`
  FROM `video_events`
),
json_stage_answers AS (
  SELECT
    `videos`.`id` AS `video_id`,
    CAST(json_extract(`answer`.`value`, '$.id') AS TEXT) AS `question_key`,
    trim(CAST(json_extract(`answer`.`value`, '$.value') AS TEXT)) AS `answer_text`,
    COALESCE(`videos`.`updated_at`, unixepoch()) AS `source_updated_at`
  FROM `videos`
  JOIN json_each(
    CASE
      WHEN json_valid(`videos`.`stage_permission`)
        THEN COALESCE(json_extract(`videos`.`stage_permission`, '$.answers'), '[]')
      ELSE '[]'
    END
  ) AS `answer`
  WHERE `videos`.`stage_permission` IS NOT NULL
    AND trim(`videos`.`stage_permission`) <> ''
)
INSERT OR IGNORE INTO `video_custom_answers` (
  `video_id`,
  `event_id`,
  `question_id`,
  `answer_text`,
  `answer_json`,
  `created_at`,
  `updated_at`
)
SELECT
  `json_stage_answers`.`video_id`,
  `event_custom_questions`.`event_id`,
  `event_custom_questions`.`id`,
  `json_stage_answers`.`answer_text`,
  NULL,
  `json_stage_answers`.`source_updated_at`,
  `json_stage_answers`.`source_updated_at`
FROM `json_stage_answers`
JOIN `video_event_targets`
  ON `video_event_targets`.`video_id` = `json_stage_answers`.`video_id`
JOIN `event_custom_questions`
  ON `event_custom_questions`.`event_id` = `video_event_targets`.`event_id`
  AND `event_custom_questions`.`question_key` = `json_stage_answers`.`question_key`
WHERE `json_stage_answers`.`question_key` IS NOT NULL
  AND `json_stage_answers`.`answer_text` IS NOT NULL
  AND `json_stage_answers`.`answer_text` <> ''
  AND `event_custom_questions`.`is_active` = 1;

--> statement-breakpoint

WITH video_event_targets AS (
  SELECT `id` AS `video_id`, `primary_event_id` AS `event_id`
  FROM `videos`
  WHERE `primary_event_id` IS NOT NULL
  UNION
  SELECT `video_id`, `event_id`
  FROM `video_events`
)
INSERT OR IGNORE INTO `video_custom_answers` (
  `video_id`,
  `event_id`,
  `question_id`,
  `answer_text`,
  `answer_json`,
  `created_at`,
  `updated_at`
)
SELECT
  `videos`.`id`,
  `event_custom_questions`.`event_id`,
  `event_custom_questions`.`id`,
  trim(`videos`.`stage_permission`),
  NULL,
  COALESCE(`videos`.`updated_at`, unixepoch()),
  COALESCE(`videos`.`updated_at`, unixepoch())
FROM `videos`
JOIN `video_event_targets`
  ON `video_event_targets`.`video_id` = `videos`.`id`
JOIN `event_custom_questions`
  ON `event_custom_questions`.`event_id` = `video_event_targets`.`event_id`
  AND `event_custom_questions`.`question_key` = 'stage_permission'
WHERE `videos`.`stage_permission` IS NOT NULL
  AND trim(`videos`.`stage_permission`) <> ''
  AND json_valid(`videos`.`stage_permission`) = 0
  AND `event_custom_questions`.`is_active` = 1;
