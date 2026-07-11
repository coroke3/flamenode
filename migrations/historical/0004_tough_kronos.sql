ALTER TABLE `video_members` ADD `name_for_sort` text;--> statement-breakpoint
CREATE INDEX `video_members_video_name_for_sort_idx` ON `video_members` (`video_id`,`name_for_sort`);--> statement-breakpoint
UPDATE `video_members` SET `name_for_sort` = lower(`name`) WHERE `name_for_sort` IS NULL;
