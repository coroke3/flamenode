-- Legacy import + DB reduction prep: columns on videos/events/event_staff.
-- Table drops (video_stats, video_softwares, …) are a follow-up migration after app code reads new columns.

ALTER TABLE videos ADD COLUMN used_software_json TEXT;
--> statement-breakpoint
ALTER TABLE videos ADD COLUMN app_like_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE videos ADD COLUMN score REAL NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE videos ADD COLUMN trending_view_count_24h INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE videos ADD COLUMN score_updated_at INTEGER;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN public_api_enabled INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN public_api_updated_at INTEGER;
--> statement-breakpoint
ALTER TABLE event_staff ADD COLUMN permission_keys_json TEXT;
