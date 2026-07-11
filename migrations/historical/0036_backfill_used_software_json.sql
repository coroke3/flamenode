-- 0036: Backfill videos.used_software_json from the deprecated video_softwares table.
-- The old table remains read-only compatibility data until a later drop migration.

UPDATE `videos`
SET `used_software_json` = (
  SELECT json_object(
    'source',
    'legacy',
    'raw',
    group_concat(`label`, ', '),
    'items',
    json_group_array(`label`)
  )
  FROM (
    SELECT
      MIN(`video_softwares`.`order_index`) AS `order_index`,
      COALESCE(NULLIF(trim(`video_softwares`.`raw_label`), ''), `software_catalog`.`name`) AS `label`
    FROM `video_softwares`
    LEFT JOIN `software_catalog`
      ON `software_catalog`.`id` = `video_softwares`.`software_id`
    WHERE `video_softwares`.`video_id` = `videos`.`id`
      AND COALESCE(NULLIF(trim(`video_softwares`.`raw_label`), ''), `software_catalog`.`name`) IS NOT NULL
      AND trim(COALESCE(NULLIF(trim(`video_softwares`.`raw_label`), ''), `software_catalog`.`name`)) <> ''
    GROUP BY lower(trim(COALESCE(NULLIF(trim(`video_softwares`.`raw_label`), ''), `software_catalog`.`name`)))
    ORDER BY `order_index`, `label`
    LIMIT 20
  )
)
WHERE `used_software_json` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `video_softwares`
    LEFT JOIN `software_catalog`
      ON `software_catalog`.`id` = `video_softwares`.`software_id`
    WHERE `video_softwares`.`video_id` = `videos`.`id`
      AND COALESCE(NULLIF(trim(`video_softwares`.`raw_label`), ''), `software_catalog`.`name`) IS NOT NULL
      AND trim(COALESCE(NULLIF(trim(`video_softwares`.`raw_label`), ''), `software_catalog`.`name`)) <> ''
  );
