CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`x_user_id` text NOT NULL,
	`html` text,
	`css` text,
	`theme_id` text,
	`shortcode_version` text,
	`is_published` integer DEFAULT false,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`author` text,
	`description` text,
	`preview_image` text,
	`template_html` text,
	`template_css` text,
	`created_at` integer NOT NULL,
	`is_default` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `event_managers` (
	`event_id` text NOT NULL,
	`x_user_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`x_user_id`) REFERENCES `x_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`explanation` text,
	`icon_url` text,
	`img_url` text,
	`is_active` integer DEFAULT false NOT NULL,
	`is_entry_open` integer DEFAULT false NOT NULL,
	`start_time` integer,
	`end_time` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`max_slots_per_video` integer DEFAULT 1 NOT NULL,
	`custom_questions` text,
	`review_settings` text,
	`editable_fields` text,
	`repeat_rules` text
);
--> statement-breakpoint
CREATE TABLE `history_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`before_data` text,
	`after_data` text,
	`operator_discord_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending',
	`attempt_count` integer DEFAULT 0,
	`next_attempt_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recommendation_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`x_user_id` text NOT NULL,
	`video_id` text NOT NULL,
	`watch_seconds` real DEFAULT 0,
	`like_score` real DEFAULT 0,
	`bookmark_score` real DEFAULT 0,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`discord_user_id` text,
	`display_name` text,
	`start_time` integer NOT NULL,
	`end_time` integer,
	`video_id` text,
	`status` text DEFAULT 'available' NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discord_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`default_editable_fields` text,
	`is_maintenance_mode` integer DEFAULT false,
	`history_retention_days` integer DEFAULT 90
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text,
	`discord_id` text,
	`role` text DEFAULT 'user',
	`is_tos_accepted` integer DEFAULT false,
	`is_banned` integer DEFAULT false,
	`is_notification_enabled` integer DEFAULT true,
	`active_x_user_id` text,
	`last_guild_check` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_discord_id_unique` ON `user` (`discord_id`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`x_user_id` text NOT NULL,
	`chapter_time` real NOT NULL,
	`chapter_label` text NOT NULL,
	`note` text,
	`visibility` text DEFAULT 'public',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`x_user_id` text NOT NULL,
	`body` text NOT NULL,
	`visibility` text DEFAULT 'public',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_events` (
	`video_id` text NOT NULL,
	`event_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`x_user_id` text NOT NULL,
	`video_id` text NOT NULL,
	`interaction_type` text NOT NULL,
	`source` text DEFAULT 'app',
	`created_at` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE TABLE `video_members` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`x_user_id` text,
	`name` text,
	`role` text,
	`comment` text,
	`order_index` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`primary_event_id` text,
	`creator_id` text,
	`owner_discord_user_id` text NOT NULL,
	`submission_type` text NOT NULL,
	`display_name` text NOT NULL,
	`display_name_yomi` text,
	`contact_x_id` text NOT NULL,
	`icon_url` text,
	`declared_experience` text,
	`title` text NOT NULL,
	`music` text,
	`credit` text,
	`music_reference_url` text,
	`closing_comment` text,
	`youtube_video_id` text,
	`stage_permission` text,
	`intro_comment` text,
	`outro_comment` text,
	`highlights` text,
	`production_story` text,
	`used_software` text,
	`custom_answers` text,
	`small_thumbnail` text,
	`large_thumbnail` text,
	`view_count` integer DEFAULT 0,
	`like_count` integer DEFAULT 0,
	`video_score` real DEFAULT 0,
	`youtube_sync_status` text DEFAULT 'pending',
	`validation_errors` text,
	`tags` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_manual_hidden` integer DEFAULT 0,
	`is_deleted` integer DEFAULT false,
	`scheduling_type` text DEFAULT 'slotted',
	`scheduled_time` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `x_account_link_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`requested_x_id` text NOT NULL,
	`link_type` text NOT NULL,
	`target_x_user_id` text,
	`status` text DEFAULT 'pending',
	`requested_at` integer NOT NULL,
	FOREIGN KEY (`discord_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `x_id_merge_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`from_x_user_id` text NOT NULL,
	`to_x_user_id` text NOT NULL,
	`requested_by_uid` text NOT NULL,
	`status` text DEFAULT 'pending',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `x_user_aliases` (
	`x_user_id` text NOT NULL,
	`alias_x_id` text NOT NULL,
	FOREIGN KEY (`x_user_id`) REFERENCES `x_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `x_user_icons` (
	`id` text PRIMARY KEY NOT NULL,
	`x_user_id` text NOT NULL,
	`icon_url` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`x_user_id`) REFERENCES `x_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `x_users` (
	`id` text PRIMARY KEY NOT NULL,
	`x_name` text NOT NULL,
	`icon_url` text,
	`profile_text` text,
	`youtube_channel_url` text,
	`other_social_links` text,
	`creative_start_date` integer,
	`linked_discord_user_id` text,
	`verification_token` text,
	`token_expires_at` integer,
	`approval_status` text DEFAULT 'pending',
	`approval_requested_at` integer,
	FOREIGN KEY (`linked_discord_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
