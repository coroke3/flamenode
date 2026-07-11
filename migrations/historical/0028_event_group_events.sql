-- 0028: Enhance event_groups and add event_group_events
-- Adds slug, group_type, icon_url, img_url, accent_color, visibility_status to event_groups
-- Creates event_group_events for many-to-many event-group membership

-- event_groups: new columns
ALTER TABLE `event_groups` ADD `slug` text NOT NULL DEFAULT '';
ALTER TABLE `event_groups` ADD `group_type` text NOT NULL DEFAULT 'series';
ALTER TABLE `event_groups` ADD `icon_url` text;
ALTER TABLE `event_groups` ADD `img_url` text;
ALTER TABLE `event_groups` ADD `accent_color` text;
ALTER TABLE `event_groups` ADD `visibility_status` text NOT NULL DEFAULT 'public';

CREATE UNIQUE INDEX IF NOT EXISTS `event_groups_slug_uniq` ON `event_groups` (`slug`);
CREATE INDEX IF NOT EXISTS `event_groups_type_sort_idx` ON `event_groups` (`group_type`, `sort_order`);
CREATE INDEX IF NOT EXISTS `event_groups_visibility_sort_idx` ON `event_groups` (`visibility_status`, `sort_order`);

-- event_group_events: new table
CREATE TABLE IF NOT EXISTS `event_group_events` (
  `event_group_id` text NOT NULL,
  `event_id` text NOT NULL,
  `relation_type` text NOT NULL DEFAULT 'member',
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(`event_group_id`, `event_id`)
);

CREATE INDEX IF NOT EXISTS `event_group_events_event_idx` ON `event_group_events` (`event_id`);
CREATE INDEX IF NOT EXISTS `event_group_events_group_sort_idx` ON `event_group_events` (`event_group_id`, `sort_order`);
CREATE INDEX IF NOT EXISTS `event_group_events_relation_idx` ON `event_group_events` (`relation_type`);

-- Backfill: migrate existing events.event_group_id to event_group_events
INSERT OR IGNORE INTO `event_group_events` (`event_group_id`, `event_id`, `relation_type`, `sort_order`, `created_at`, `updated_at`)
SELECT `event_group_id`, `id`, 'primary', 0, unixepoch(), unixepoch()
FROM `events`
WHERE `event_group_id` IS NOT NULL AND `event_group_id` != '';

-- Backfill: generate slugs from existing event_groups
UPDATE `event_groups` SET `slug` = LOWER(REPLACE(REPLACE(REPLACE(`name`, ' ', '-'), '　', '-'), '.', '-')) WHERE `slug` = '' OR `slug` IS NULL;
