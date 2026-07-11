-- Production-prep MVP slimming.
-- video_comments is removed in favor of video_chapters / video_members.chapters_json.
-- dashboard_metrics_cache is removed because admin top now uses lightweight live pending counts.
DROP INDEX IF EXISTS video_comments_video_created_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS video_comments_chapter_idx;
--> statement-breakpoint
DROP TABLE IF EXISTS video_comments;
--> statement-breakpoint
DROP TABLE IF EXISTS dashboard_metrics_cache;
