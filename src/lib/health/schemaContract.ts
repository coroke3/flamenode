/**
 * Production runtime schema contract.
 *
 * Keep this list aligned with the tables exported by src/lib/db/schema.ts.
 * d1_migrations is included because production preflight must also prove that
 * every active migration was applied without performing a migration itself.
 */
export const REQUIRED_SCHEMA_VERSION = "2026-07-20-canonical-1";

export const RUNTIME_CRITICAL_TABLES = Object.freeze([
  "account",
  "announcements",
  "audit_logs",
  "audit_restore_runs",
  "d1_migrations",
  "event_custom_questions",
  "event_group_events",
  "event_groups",
  "event_staff",
  "event_templates",
  "event_youtube_playlist_items",
  "event_youtube_playlist_sync",
  "events",
  "external_api_quota_usage",
  "flamenode_schema_meta",
  "notification_outbox",
  "public_visibility_fences",
  "session",
  "slots",
  "software_aliases",
  "software_catalog",
  "spreadsheet_import_runs",
  "static_artifacts",
  "static_rebuild_queue",
  "system_settings",
  "terms_versions",
  "user",
  "user_tos_consents",
  "verificationToken",
  "video_chapters",
  "video_custom_answers",
  "video_events",
  "video_interactions",
  "video_members",
  "video_moderation_cases",
  "video_softwares",
  "video_youtube_metadata",
  "videos",
  "worker_leases",
  "x_identity_requests",
  "x_user_account_links",
  "x_user_aliases",
  "x_users",
] as const);

export const REQUIRED_RUNTIME_TABLE_COUNT = RUNTIME_CRITICAL_TABLES.length;
