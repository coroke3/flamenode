-- 0039: Finalize event_group_events as canonical; clear legacy events.event_group_id

-- Backfill any remaining legacy links into junction
INSERT OR IGNORE INTO `event_group_events` (
  `event_group_id`,
  `event_id`,
  `relation_type`,
  `sort_order`,
  `created_at`,
  `updated_at`
)
SELECT
  `event_group_id`,
  `id`,
  'member',
  0,
  unixepoch(),
  unixepoch()
FROM `events`
WHERE `event_group_id` IS NOT NULL
  AND trim(`event_group_id`) <> '';

-- Repair duplicate slugs (append short id suffix)
UPDATE `event_groups`
SET `slug` = `slug` || '-' || substr(`id`, -6)
WHERE `id` IN (
  SELECT `id` FROM `event_groups` g1
  WHERE EXISTS (
    SELECT 1 FROM `event_groups` g2
    WHERE g2.slug = g1.slug AND g2.id <> g1.id
  )
);

-- Legacy column: stop using as source of truth (data retained for rollback)
UPDATE `events` SET `event_group_id` = NULL
WHERE `event_group_id` IS NOT NULL;
