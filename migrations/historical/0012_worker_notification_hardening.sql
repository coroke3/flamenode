ALTER TABLE `videos` ADD `youtube_synced_at` integer;--> statement-breakpoint
ALTER TABLE `videos` ADD `youtube_status` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `youtube_duration_seconds` integer;--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD `processing_started_at` integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_outbox_processing_started_idx` ON `notification_outbox` (`status`,`processing_started_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `videos_youtube_synced_at_idx` ON `videos` (`youtube_synced_at`);
