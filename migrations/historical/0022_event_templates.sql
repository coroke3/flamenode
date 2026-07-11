-- Event configuration templates (admin-only). No slots, videos, or staff.
CREATE TABLE `event_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `source_event_id` text,
  `settings_json` text NOT NULL,
  `created_by_user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_templates_updated_idx` ON `event_templates` (`updated_at` DESC);
