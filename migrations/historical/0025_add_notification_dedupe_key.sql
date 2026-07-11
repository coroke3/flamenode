ALTER TABLE `notification_outbox` ADD `dedupe_key` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_outbox_dedupe_idx` ON `notification_outbox` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_outbox_status_dedupe_idx` ON `notification_outbox` (`status`,`dedupe_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notification_outbox_active_dedupe_uniq` ON `notification_outbox` (`dedupe_key`) WHERE `dedupe_key` IS NOT NULL AND `status` IN ('pending', 'processing', 'sent');
