CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`severity` text DEFAULT 'info',
	`is_published` integer DEFAULT 0,
	`publish_at` integer,
	`expire_at` integer,
	`target_audience` text DEFAULT 'all',
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`is_active` integer DEFAULT 1,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_usage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`captured_at` integer NOT NULL,
	`source` text,
	`workers_requests_today` integer DEFAULT 0,
	`pages_functions_requests_today` integer DEFAULT 0,
	`d1_rows_read_today` integer DEFAULT 0,
	`d1_rows_written_today` integer DEFAULT 0,
	`r2_storage_gb_month_estimate` real DEFAULT 0,
	`r2_class_a_month` integer DEFAULT 0,
	`r2_class_b_month` integer DEFAULT 0,
	`durable_object_requests_today` integer DEFAULT 0,
	`durable_object_duration_gb_s_today` real DEFAULT 0,
	`kv_reads_today` integer DEFAULT 0,
	`kv_writes_today` integer DEFAULT 0,
	`queues_operations_today` integer DEFAULT 0,
	`guard_mode_after_check` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`x_user_id` text NOT NULL,
	`html` text,
	`css` text,
	`theme_id` text,
	`shortcode_version` text,
	`is_published` integer DEFAULT 0,
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
	`is_default` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `dashboard_metrics_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`total_users` integer DEFAULT 0,
	`total_videos` integer DEFAULT 0,
	`active_users_last_5m` integer DEFAULT 0,
	`new_videos_last_24h` integer DEFAULT 0,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_collaborator_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`x_user_id` text,
	`discord_user_id` text,
	`display_name` text NOT NULL,
	`permission_key` text NOT NULL,
	`allowed` integer DEFAULT 1 NOT NULL,
	`is_public_staff` integer DEFAULT 0,
	`public_role_label` text,
	`granted_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_editors` (
	`event_id` text NOT NULL,
	`x_user_id` text NOT NULL,
	`role` text DEFAULT 'editor',
	`is_public` integer DEFAULT 1,
	`public_role_label` text,
	`operation_scope_json` text,
	`internal_note` text,
	`approved_by_user_id` text,
	`approved_at` integer,
	PRIMARY KEY(`event_id`, `x_user_id`)
);
--> statement-breakpoint
CREATE TABLE `event_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`event_type` text DEFAULT 'event',
	`explanation` text,
	`icon_url` text,
	`img_url` text,
	`accent_color` text,
	`representative_x_user_id` text,
	`is_active` integer DEFAULT 0 NOT NULL,
	`is_entry_open` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT 0 NOT NULL,
	`event_group_id` text,
	`slot_type` text DEFAULT 'time',
	`slot_visibility_mode` text DEFAULT 'public_name',
	`start_time` integer,
	`end_time` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`max_slots_per_video` integer DEFAULT 1 NOT NULL,
	`max_consecutive_slots_per_entry` integer DEFAULT 3 NOT NULL,
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
	`retention_class` text DEFAULT 'normal',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
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
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
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
	`x_user_id` text,
	`display_name` text,
	`slot_kind` text DEFAULT 'time',
	`slot_label` text,
	`start_time` integer,
	`end_time` integer,
	`sort_order` integer DEFAULT 0,
	`reservation_group_id` text,
	`priority_reclaim_video_id` text,
	`priority_reclaim_until` integer,
	`video_id` text,
	`status` text DEFAULT 'available' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `slots_event_idx` ON `slots` (`event_id`,`start_time`);--> statement-breakpoint
CREATE INDEX `slots_video_idx` ON `slots` (`video_id`);--> statement-breakpoint
CREATE TABLE `software_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`software_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `software_aliases_uniq` ON `software_aliases` (`software_id`,`normalized_alias`);--> statement-breakpoint
CREATE TABLE `software_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`category` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `software_catalog_norm_uniq` ON `software_catalog` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`default_editable_fields` text,
	`upcoming_editable_fields` text,
	`is_maintenance_mode` integer DEFAULT 0,
	`history_retention_days` integer DEFAULT 90,
	`cost_guard_mode` text DEFAULT 'normal',
	`auto_cost_guard_enabled` integer DEFAULT 1,
	`cost_guard_thresholds_json` text,
	`disabled_features_json` text,
	`cost_guard_reason` text,
	`cost_guard_updated_by_user_id` text,
	`cost_guard_updated_at` integer,
	`cost_guard_exception_until` integer,
	`cost_guard_exception_features_json` text
);
--> statement-breakpoint
CREATE TABLE `terms_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version_label` text NOT NULL,
	`body_markdown` text NOT NULL,
	`status` text DEFAULT 'draft',
	`severity` text DEFAULT 'minor',
	`published_at` integer,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_tos_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`terms_version_id` text NOT NULL,
	`consented_at` integer NOT NULL,
	`consent_context` text NOT NULL
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
	`is_tos_accepted` integer DEFAULT 0,
	`accepted_terms_version_id` text,
	`terms_reaccept_required` integer DEFAULT 0,
	`is_banned` integer DEFAULT 0,
	`is_notification_enabled` integer DEFAULT 1,
	`active_x_user_id` text,
	`last_guild_check` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_discord_id_unique` ON `user` (`discord_id`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
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
	`marker_kind` text DEFAULT 'comment',
	`show_on_player_bar` integer DEFAULT 0,
	`order_index` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`x_user_id` text NOT NULL,
	`chapter_id` text,
	`body` text NOT NULL,
	`visibility` text DEFAULT 'public',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_events` (
	`video_id` text NOT NULL,
	`event_id` text NOT NULL,
	PRIMARY KEY(`video_id`, `event_id`)
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
CREATE UNIQUE INDEX `video_interactions_uniq` ON `video_interactions` (`x_user_id`,`video_id`,`interaction_type`);--> statement-breakpoint
CREATE TABLE `video_members` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`x_user_id` text,
	`name` text NOT NULL,
	`role` text,
	`comment` text,
	`order_index` integer DEFAULT 0 NOT NULL
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
	`view_count` integer DEFAULT 0,
	`like_count` integer DEFAULT 0,
	`youtube_view_count` integer DEFAULT 0,
	`trending_view_count_24h` integer DEFAULT 0,
	`video_score` real DEFAULT 0,
	`youtube_sync_status` text DEFAULT 'pending',
	`validation_errors` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_manual_hidden` integer DEFAULT 0,
	`is_deleted` integer DEFAULT 0,
	`x_reapply_request_id` text,
	`x_reapply_started_at` integer,
	`x_reapply_due_at` integer,
	`x_reapply_rejected_x_user_id` text,
	`x_reapply_public_reason` text,
	`x_reapply_attempt_count` integer DEFAULT 0,
	`x_reapply_locked_until` integer,
	`voided_by_user_id` text,
	`voided_at` integer,
	`void_reason` text,
	`void_reason_category` text,
	`void_detail_private` text,
	`void_physical_delete_candidate_at` integer,
	`void_restored_by_user_id` text,
	`void_restored_at` integer,
	`scheduling_type` text DEFAULT 'slotted',
	`scheduled_time` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `videos_status_idx` ON `videos` (`status`);--> statement-breakpoint
CREATE INDEX `videos_scheduled_idx` ON `videos` (`scheduled_time`);--> statement-breakpoint
CREATE INDEX `videos_score_idx` ON `videos` (`video_score`);--> statement-breakpoint
CREATE INDEX `videos_primary_event_idx` ON `videos` (`primary_event_id`);--> statement-breakpoint
CREATE INDEX `videos_owner_idx` ON `videos` (`owner_discord_user_id`);--> statement-breakpoint
CREATE INDEX `videos_creator_idx` ON `videos` (`creator_id`);--> statement-breakpoint
CREATE INDEX `videos_youtube_id_idx` ON `videos` (`youtube_video_id`);--> statement-breakpoint
CREATE TABLE `x_account_link_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`requested_x_id` text NOT NULL,
	`link_type` text NOT NULL,
	`target_x_user_id` text,
	`status` text DEFAULT 'pending',
	`requested_at` integer NOT NULL
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
CREATE TABLE `x_id_merge_reverts` (
	`id` text PRIMARY KEY NOT NULL,
	`merge_request_id` text NOT NULL,
	`requested_by_uid` text NOT NULL,
	`status` text DEFAULT 'pending',
	`restore_snapshot_json` text NOT NULL,
	`revert_deadline_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `x_user_aliases` (
	`x_user_id` text NOT NULL,
	`alias_x_id` text NOT NULL,
	PRIMARY KEY(`x_user_id`, `alias_x_id`)
);
--> statement-breakpoint
CREATE TABLE `x_user_icons` (
	`id` text PRIMARY KEY NOT NULL,
	`x_user_id` text NOT NULL,
	`icon_url` text NOT NULL,
	`source_video_id` text,
	`source_type` text DEFAULT 'video',
	`created_at` integer NOT NULL
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
	`approval_requested_at` integer
);
