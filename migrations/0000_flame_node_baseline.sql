-- Migration: 0000_flame_node_baseline.sql
-- Date: 2026-07-11
-- Type: baseline
-- Summary: FlameNode final canonical schema baseline
-- Data loss: intentional (pre-production baseline; remote D1 is never changed automatically)
-- Rollback: not safely reversible
-- Change log: docs/database/change-log.md

PRAGMA foreign_keys = ON;

CREATE TABLE "account" (
  "userId" text NOT NULL,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "providerAccountId" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  PRIMARY KEY ("provider", "providerAccountId"),
  FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "announcements" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "severity" text DEFAULT 'info' CHECK ("severity" IN ('info', 'warning', 'danger')),
  "is_published" integer DEFAULT 0,
  "publish_at" integer,
  "expire_at" integer,
  "target_audience" text DEFAULT 'all' CHECK ("target_audience" IN ('all', 'creators', 'admins')),
  "created_by_user_id" text,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "audit_log_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "normal_retention_days" integer NOT NULL DEFAULT 30,
  "restorable_retention_days" integer NOT NULL DEFAULT 180,
  "long_audit_retention_days" integer NOT NULL DEFAULT 365,
  "max_payload_bytes" integer NOT NULL DEFAULT 20000,
  "compact_after_days" integer NOT NULL DEFAULT 30,
  "updated_by_user_id" text,
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "audit_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "table_name" text NOT NULL,
  "target_id" text NOT NULL,
  "operation" text NOT NULL CHECK ("operation" IN ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'STATUS_CHANGE', 'MERGE', 'SYSTEM')),
  "before_json" text,
  "after_json" text,
  "changed_keys_json" text,
  "inverse_patch_json" text,
  "actor_user_id" text NOT NULL,
  "actor_snapshot_json" text,
  "reason" text,
  "context" text,
  "retention_class" text NOT NULL DEFAULT 'normal' CHECK ("retention_class" IN ('normal', 'restorable', 'long_audit')),
  "restore_strategy" text NOT NULL DEFAULT 'none' CHECK ("restore_strategy" IN ('none', 'update_before', 'delete_created', 'recreate_deleted', 'custom_adapter')),
  "restore_status" text NOT NULL DEFAULT 'not_restorable' CHECK ("restore_status" IN ('not_restorable', 'restorable', 'restored', 'expired', 'blocked', 'failed')),
  "restore_unavailable_reason_code" text,
  "restore_unavailable_message" text,
  "payload_size_bytes" integer NOT NULL DEFAULT 0,
  "expires_at" integer,
  "created_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "audit_logs_table_target_idx" ON "audit_logs" ("table_name", "target_id");
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" ("actor_user_id", "created_at");
CREATE INDEX "audit_logs_restore_status_idx" ON "audit_logs" ("restore_status");
CREATE INDEX "audit_logs_expires_idx" ON "audit_logs" ("expires_at");
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" ("created_at");
CREATE INDEX "audit_logs_operation_idx" ON "audit_logs" ("operation", "created_at");

CREATE TABLE "audit_restore_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "audit_log_id" text NOT NULL,
  "executed_by_user_id" text NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('success', 'failed')),
  "error_message" text,
  "executed_at" integer NOT NULL
);
CREATE INDEX "audit_restore_runs_log_idx" ON "audit_restore_runs" ("audit_log_id");
CREATE INDEX "audit_restore_runs_user_idx" ON "audit_restore_runs" ("executed_by_user_id");
CREATE INDEX "audit_restore_runs_executed_at_idx" ON "audit_restore_runs" ("executed_at");

CREATE TABLE "cost_usage_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "captured_at" integer NOT NULL,
  "source" text CHECK ("source" IN ('cloudflare_dashboard', 'graphql_analytics', 'estimated_local')),
  "workers_requests_today" integer DEFAULT 0,
  "pages_functions_requests_today" integer DEFAULT 0,
  "d1_rows_read_today" integer DEFAULT 0,
  "d1_rows_written_today" integer DEFAULT 0,
  "r2_storage_gb_month_estimate" real DEFAULT 0,
  "r2_class_a_month" integer DEFAULT 0,
  "r2_class_b_month" integer DEFAULT 0,
  "durable_object_requests_today" integer DEFAULT 0,
  "durable_object_duration_gb_s_today" real DEFAULT 0,
  "kv_reads_today" integer DEFAULT 0,
  "kv_writes_today" integer DEFAULT 0,
  "queues_operations_today" integer DEFAULT 0,
  "guard_mode_after_check" text,
  "created_at" integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "event_custom_questions" (
  "id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL,
  "question_key" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "type" text NOT NULL DEFAULT 'textarea' CHECK ("type" IN ('text', 'textarea', 'select', 'radio', 'checkbox')),
  "required" integer NOT NULL DEFAULT 0,
  "options_json" text,
  "placeholder" text,
  "max_length" integer,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" integer NOT NULL DEFAULT 1,
  "visibility" text NOT NULL DEFAULT 'review' CHECK ("visibility" IN ('review', 'private', 'public')),
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX "event_custom_questions_event_key_uniq" ON "event_custom_questions" ("event_id", "question_key");
CREATE INDEX "event_custom_questions_event_sort_idx" ON "event_custom_questions" ("event_id", "sort_order");
CREATE INDEX "event_custom_questions_event_active_sort_idx" ON "event_custom_questions" ("event_id", "is_active", "sort_order");

CREATE TABLE "event_group_events" (
  "event_group_id" text NOT NULL,
  "event_id" text NOT NULL,
  "relation_type" text NOT NULL DEFAULT 'member' CHECK ("relation_type" IN ('member', 'primary', 'related')),
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("event_group_id", "event_id")
);
CREATE INDEX "event_group_events_event_idx" ON "event_group_events" ("event_id");
CREATE INDEX "event_group_events_group_sort_idx" ON "event_group_events" ("event_group_id", "sort_order");
CREATE INDEX "event_group_events_relation_idx" ON "event_group_events" ("relation_type");

CREATE TABLE "event_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "group_type" text NOT NULL DEFAULT 'series' CHECK ("group_type" IN ('series', 'genre', 'related', 'collection', 'other')),
  "icon_url" text,
  "img_url" text,
  "accent_color" text,
  "visibility_status" text NOT NULL DEFAULT 'public' CHECK ("visibility_status" IN ('public', 'private', 'archived')),
  "sort_order" integer DEFAULT 0,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX "event_groups_slug_uniq" ON "event_groups" ("slug");
CREATE INDEX "event_groups_type_sort_idx" ON "event_groups" ("group_type", "sort_order");
CREATE INDEX "event_groups_visibility_sort_idx" ON "event_groups" ("visibility_status", "sort_order");

CREATE TABLE "event_staff" (
  "id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL,
  "x_user_id" text,
  "user_id" text,
  "display_name" text NOT NULL,
  "role" text NOT NULL DEFAULT 'staff' CHECK ("role" IN ('representative', 'editor', 'staff')),
  "permission_preset" text NOT NULL DEFAULT 'public_staff' CHECK ("permission_preset" IN ('owner', 'manager', 'slot_manager', 'content_editor', 'reviewer', 'xid_reviewer', 'public_staff', 'custom')),
  "custom_permission_keys_json" text,
  "is_public" integer NOT NULL DEFAULT 0,
  "public_role_label" text,
  "internal_note" text,
  "approved_by_user_id" text,
  "approved_at" integer,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("x_user_id") REFERENCES "x_users" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("approved_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL,
  CONSTRAINT "event_staff_subject_required" CHECK ("user_id" IS NOT NULL OR "x_user_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "event_staff_event_x_uniq" ON "event_staff" ("event_id", "x_user_id");
CREATE UNIQUE INDEX "event_staff_event_user_uniq" ON "event_staff" ("event_id", "user_id");
CREATE INDEX "event_staff_event_idx" ON "event_staff" ("event_id");
CREATE INDEX "event_staff_event_preset_idx" ON "event_staff" ("event_id", "permission_preset");
CREATE INDEX "event_staff_public_idx" ON "event_staff" ("event_id", "is_public", "display_name");

CREATE TABLE "event_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "source_event_id" text,
  "settings_json" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "event_templates_updated_idx" ON "event_templates" ("updated_at");

CREATE TABLE "events" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "event_type" text DEFAULT 'event' CHECK ("event_type" IN ('event', 'collabo', 'type', 'other')),
  "explanation" text,
  "icon_url" text,
  "img_url" text,
  "accent_color" text,
  "representative_x_user_id" text,
  "visibility_status" text NOT NULL DEFAULT 'draft' CHECK ("visibility_status" IN ('draft', 'private', 'public', 'archived')),
  "allow_user_video_event_links" integer NOT NULL DEFAULT 0,
  "allow_unslotted_posts" integer NOT NULL DEFAULT 0,
  "allow_user_video_edits" integer NOT NULL DEFAULT 0,
  "user_video_edit_permission_keys_json" text,
  "slot_type" text DEFAULT 'time' CHECK ("slot_type" IN ('time', 'count')),
  "slot_visibility_mode" text DEFAULT 'public_name' CHECK ("slot_visibility_mode" IN ('public_name', 'anonymous', 'hidden')),
  "start_time" integer,
  "end_time" integer,
  "entry_start_time" integer,
  "entry_end_time" integer,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  "max_slots_per_video" integer NOT NULL DEFAULT 1,
  "max_consecutive_slots_per_entry" integer NOT NULL DEFAULT 3,
  "review_settings" text,
  "editable_fields" text,
  "repeat_rules" text,
  "slot_part_gap_minutes" integer DEFAULT 15,
  "parts_json" text,
  "public_api_enabled" integer NOT NULL DEFAULT 0,
  "public_api_updated_at" integer
);

CREATE TABLE "flamenode_schema_meta" (
  "id" text PRIMARY KEY NOT NULL,
  "version" text NOT NULL,
  "applied_at" integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "legacy_import_batch_items" (
  "batch_id" text NOT NULL,
  "target_table" text NOT NULL,
  "target_id" text NOT NULL,
  "action" text NOT NULL,
  "source_key" text,
  "status" text NOT NULL,
  "warning_count" integer NOT NULL DEFAULT 0,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("batch_id", "target_table", "target_id")
);
CREATE INDEX "legacy_import_batch_items_target_idx" ON "legacy_import_batch_items" ("target_table", "target_id");

CREATE TABLE "legacy_import_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "file_count" integer NOT NULL,
  "file_names_json" text,
  "file_hash" text NOT NULL,
  "plan_hash" text NOT NULL,
  "parser_version" text NOT NULL,
  "schema_version" text NOT NULL,
  "strategy_json" text NOT NULL,
  "counts_json" text,
  "warning_count" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,
  "executed_by_user_id" text NOT NULL,
  "created_at" integer NOT NULL,
  "applied_at" integer,
  "failed_at" integer,
  "error_summary" text,
  "canonical_plan_json" text,
  "preview_expires_at" integer,
  "lease_token" text,
  "lease_expires_at" integer,
  "consumed_at" integer
);
CREATE INDEX "legacy_import_batches_created_idx" ON "legacy_import_batches" ("created_at");
CREATE INDEX "legacy_import_batches_file_hash_idx" ON "legacy_import_batches" ("file_hash");
CREATE INDEX "legacy_import_batches_lease_idx" ON "legacy_import_batches" ("status", "lease_expires_at");

CREATE TABLE "notification_outbox" (
  "id" text PRIMARY KEY NOT NULL,
  "recipient_user_id" text NOT NULL,
  "type" text NOT NULL,
  "payload_json" text NOT NULL,
  "status" text DEFAULT 'pending' CHECK ("status" IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'dead_letter')),
  "attempt_count" integer DEFAULT 0,
  "processing_started_at" integer,
  "lease_token" text,
  "lease_expires_at" integer,
  "next_attempt_at" integer,
  "last_error" text,
  "processed_at" integer,
  "event_id" text,
  "dedupe_key" text,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY ("recipient_user_id") REFERENCES "user" ("id") ON DELETE RESTRICT
);
CREATE INDEX "notification_outbox_status_created_idx" ON "notification_outbox" ("status", "created_at");
CREATE INDEX "notification_outbox_processing_started_idx" ON "notification_outbox" ("status", "processing_started_at");
CREATE INDEX "notification_outbox_lease_idx" ON "notification_outbox" ("status", "lease_expires_at");
CREATE INDEX "notification_outbox_event_idx" ON "notification_outbox" ("event_id");
CREATE INDEX "notification_outbox_dedupe_idx" ON "notification_outbox" ("dedupe_key");
CREATE INDEX "notification_outbox_status_dedupe_idx" ON "notification_outbox" ("status", "dedupe_key");
CREATE UNIQUE INDEX "notification_outbox_active_dedupe_uniq" ON "notification_outbox" ("dedupe_key") WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'processing', 'sent');

CREATE TABLE "session" (
  "sessionToken" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "expires" integer NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "slots" (
  "id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL,
  "reserved_by_user_id" text,
  "x_user_id" text,
  "display_name" text,
  "slot_kind" text DEFAULT 'time' CHECK ("slot_kind" IN ('time', 'count')),
  "slot_label" text,
  "start_time" integer,
  "sort_order" integer DEFAULT 0,
  "reservation_group_id" text,
  "priority_reclaim_video_id" text,
  "priority_reclaim_until" integer,
  "video_id" text,
  "status" text NOT NULL DEFAULT 'available' CHECK ("status" IN ('available', 'reserved', 'submitted')),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  "version" integer NOT NULL DEFAULT 1,
  FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("reserved_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("x_user_id") REFERENCES "x_users" ("id") ON DELETE SET NULL
);
CREATE INDEX "slots_event_idx" ON "slots" ("event_id", "start_time");
CREATE INDEX "slots_video_idx" ON "slots" ("video_id");

CREATE TABLE "software_aliases" (
  "id" text PRIMARY KEY NOT NULL,
  "software_id" text NOT NULL,
  "alias" text NOT NULL,
  "normalized_alias" text NOT NULL
);
CREATE UNIQUE INDEX "software_aliases_uniq" ON "software_aliases" ("software_id", "normalized_alias");
CREATE UNIQUE INDEX "software_aliases_global_alias_uniq" ON "software_aliases" ("normalized_alias");

CREATE TABLE "software_catalog" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "category" text,
  "usage_count" integer NOT NULL DEFAULT 0,
  "is_active" integer NOT NULL DEFAULT 1,
  "is_verified" integer NOT NULL DEFAULT 0,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX "software_catalog_norm_uniq" ON "software_catalog" ("normalized_name");

CREATE TABLE "static_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "object_key" text NOT NULL,
  "content_hash" text NOT NULL,
  "schema_version" integer NOT NULL,
  "source_updated_at" integer,
  "generated_at" integer NOT NULL,
  "deleted_at" integer
);
CREATE UNIQUE INDEX "static_artifacts_target_key_uniq" ON "static_artifacts" ("target_type", "target_id", "object_key");
CREATE UNIQUE INDEX "static_artifacts_live_key_uniq" ON "static_artifacts" ("object_key") WHERE "deleted_at" IS NULL;
CREATE INDEX "static_artifacts_target_idx" ON "static_artifacts" ("target_type", "target_id", "deleted_at");

CREATE TABLE "static_rebuild_queue" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "reason" text,
  "priority" text NOT NULL DEFAULT 'normal' CHECK ("priority" IN ('high', 'normal', 'low')),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'processing', 'done', 'failed', 'dead_letter')),
  "attempt_count" integer NOT NULL DEFAULT 0,
  "requested_by_user_id" text,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  "processing_started_at" integer,
  "lease_token" text,
  "lease_expires_at" integer,
  "processed_at" integer,
  "next_retry_at" integer,
  "error" text
);
CREATE UNIQUE INDEX "static_rebuild_queue_target_pending_uniq" ON "static_rebuild_queue" ("target_type", "target_id") WHERE status IN ('pending', 'processing');
CREATE INDEX "static_rebuild_queue_status_priority_idx" ON "static_rebuild_queue" ("status", "priority", "created_at");
CREATE INDEX "static_rebuild_queue_next_retry_idx" ON "static_rebuild_queue" ("status", "next_retry_at");
CREATE INDEX "static_rebuild_queue_lease_idx" ON "static_rebuild_queue" ("status", "lease_expires_at");

CREATE TABLE "system_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "default_editable_fields" text,
  "upcoming_editable_fields" text,
  "history_retention_days" integer DEFAULT 90,
  "operation_mode" text DEFAULT 'normal' CHECK ("operation_mode" IN ('normal', 'economy', 'read_only', 'static_only', 'maintenance')),
  "auto_cost_guard_enabled" integer DEFAULT 1,
  "cost_guard_thresholds_json" text,
  "disabled_features_json" text,
  "cost_guard_reason" text,
  "cost_guard_updated_by_user_id" text,
  "cost_guard_updated_at" integer,
  "cost_guard_exception_until" integer,
  "cost_guard_exception_features_json" text
);

CREATE TABLE "terms_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "version_label" text NOT NULL,
  "body_markdown" text NOT NULL,
  "status" text DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
  "severity" text DEFAULT 'minor' CHECK ("severity" IN ('minor', 'major')),
  "published_at" integer,
  "created_by_user_id" text NOT NULL,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "email" text,
  "emailVerified" integer,
  "image" text,
  "discord_id" text,
  "role" text DEFAULT 'user' CHECK ("role" IN ('user', 'admin', 'moderator')),
  "can_create_events" integer NOT NULL DEFAULT 0,
  "is_tos_accepted" integer DEFAULT 0,
  "accepted_terms_version_id" text,
  "terms_reaccept_required" integer DEFAULT 0,
  "is_banned" integer DEFAULT 0,
  "is_notification_enabled" integer DEFAULT 1,
  "active_x_user_id" text,
  "onboarding_completed_at" integer,
  "last_guild_check" integer,
  "created_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX "user_discord_id_unique" ON "user" ("discord_id");

CREATE TABLE "user_tos_consents" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "terms_version_id" text NOT NULL,
  "consented_at" integer NOT NULL,
  "consent_context" text NOT NULL CHECK ("consent_context" IN ('entry', 'post', 'edit', 'admin'))
);

CREATE TABLE "verificationToken" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" integer NOT NULL,
  PRIMARY KEY ("identifier", "token")
);

CREATE TABLE "video_chapters" (
  "id" text PRIMARY KEY NOT NULL,
  "video_id" text NOT NULL,
  "x_user_id" text NOT NULL,
  "chapter_time" real NOT NULL,
  "chapter_label" text NOT NULL,
  "note" text,
  "visibility" text DEFAULT 'public' CHECK ("visibility" IN ('private', 'public')),
  "show_on_player_bar" integer DEFAULT 0,
  "order_index" integer DEFAULT 0,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  FOREIGN KEY ("video_id") REFERENCES "videos" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("x_user_id") REFERENCES "x_users" ("id") ON DELETE RESTRICT
);
CREATE INDEX "video_chapters_video_time_idx" ON "video_chapters" ("video_id", "chapter_time");

CREATE TABLE "video_custom_answers" (
  "video_id" text NOT NULL,
  "event_id" text NOT NULL,
  "question_id" text NOT NULL,
  "answer_text" text,
  "answer_json" text,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("video_id", "event_id", "question_id")
);
CREATE INDEX "video_custom_answers_video_idx" ON "video_custom_answers" ("video_id");
CREATE INDEX "video_custom_answers_event_idx" ON "video_custom_answers" ("event_id");
CREATE INDEX "video_custom_answers_question_idx" ON "video_custom_answers" ("question_id");
CREATE INDEX "video_custom_answers_video_event_idx" ON "video_custom_answers" ("video_id", "event_id");

CREATE TABLE "video_events" (
  "video_id" text NOT NULL,
  "event_id" text NOT NULL,
  PRIMARY KEY ("video_id", "event_id"),
  FOREIGN KEY ("video_id") REFERENCES "videos" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE
);
CREATE INDEX "video_events_event_video_idx" ON "video_events" ("event_id", "video_id");

CREATE TABLE "video_interactions" (
  "id" text PRIMARY KEY NOT NULL,
  "x_user_id" text NOT NULL,
  "video_id" text NOT NULL,
  "interaction_type" text NOT NULL CHECK ("interaction_type" IN ('like', 'bookmark')),
  "source" text DEFAULT 'app' CHECK ("source" IN ('app', 'youtube')),
  "created_at" integer NOT NULL,
  "synced_at" integer
);
CREATE UNIQUE INDEX "video_interactions_uniq" ON "video_interactions" ("x_user_id", "video_id", "interaction_type");

CREATE TABLE "video_members" (
  "id" text PRIMARY KEY NOT NULL,
  "video_id" text NOT NULL,
  "x_user_id" text,
  "name" text NOT NULL,
  "role" text,
  "comment" text,
  "order_index" integer NOT NULL DEFAULT 0,
  "user_id" text,
  "can_edit" integer NOT NULL DEFAULT 0,
  "is_public_member" integer NOT NULL DEFAULT 1,
  "edit_granted_by_user_id" text,
  "edit_granted_at" integer,
  "edit_updated_at" integer,
  "chapters_json" text,
  FOREIGN KEY ("video_id") REFERENCES "videos" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("x_user_id") REFERENCES "x_users" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE SET NULL
);
CREATE INDEX "video_members_video_order_idx" ON "video_members" ("video_id", "order_index");
CREATE INDEX "video_members_video_name_idx" ON "video_members" ("video_id", "name");
CREATE INDEX "video_members_video_can_edit_idx" ON "video_members" ("video_id", "can_edit");
CREATE INDEX "video_members_user_idx" ON "video_members" ("user_id");

CREATE TABLE "video_moderation_cases" (
  "id" text PRIMARY KEY NOT NULL,
  "video_id" text NOT NULL,
  "case_type" text NOT NULL CHECK ("case_type" IN ('x_reapply', 'void', 'duplicate', 'rights', 'operator')),
  "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'resolved', 'rejected', 'expired', 'cancelled')),
  "public_reason" text,
  "private_note" text,
  "due_at" integer,
  "locked_until" integer,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "related_x_user_id" text,
  "created_by_user_id" text,
  "resolved_by_user_id" text,
  "created_at" integer NOT NULL,
  "resolved_at" integer,
  FOREIGN KEY ("video_id") REFERENCES "videos" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("related_x_user_id") REFERENCES "x_users" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("created_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL
);
CREATE INDEX "video_moderation_cases_video_idx" ON "video_moderation_cases" ("video_id", "created_at");
CREATE INDEX "video_moderation_cases_type_status_idx" ON "video_moderation_cases" ("case_type", "status");

CREATE TABLE "video_softwares" (
  "video_id" text NOT NULL,
  "software_id" text NOT NULL,
  "raw_label" text NOT NULL,
  "order_index" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("video_id", "software_id"),
  FOREIGN KEY ("video_id") REFERENCES "videos" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("software_id") REFERENCES "software_catalog" ("id") ON DELETE RESTRICT
);
CREATE INDEX "video_softwares_software_video_idx" ON "video_softwares" ("software_id", "video_id");
CREATE INDEX "video_softwares_video_order_idx" ON "video_softwares" ("video_id", "order_index");

CREATE TABLE "video_youtube_metadata" (
  "video_id" text PRIMARY KEY NOT NULL,
  "youtube_video_id" text,
  "youtube_privacy_status" text,
  "youtube_availability_status" text,
  "duration_seconds" integer,
  "view_count" integer NOT NULL DEFAULT 0,
  "synced_at" integer,
  "sync_status" text NOT NULL DEFAULT 'pending' CHECK ("sync_status" IN ('pending', 'synced', 'failed')),
  "sync_error" text,
  "updated_at" integer NOT NULL,
  FOREIGN KEY ("video_id") REFERENCES "videos" ("id") ON DELETE CASCADE
);
CREATE INDEX "video_youtube_metadata_youtube_idx" ON "video_youtube_metadata" ("youtube_video_id");
CREATE INDEX "video_youtube_metadata_sync_idx" ON "video_youtube_metadata" ("sync_status", "synced_at");

CREATE TABLE "videos" (
  "id" text PRIMARY KEY NOT NULL,
  "primary_event_id" text,
  "creator_x_user_id" text,
  "submitted_by_user_id" text NOT NULL,
  "collaboration_type" text NOT NULL DEFAULT 'individual' CHECK ("collaboration_type" IN ('individual', 'collab')),
  "part" text,
  "source_type" text NOT NULL DEFAULT 'youtube' CHECK ("source_type" IN ('youtube', 'manual', 'external')),
  "creator_display_name" text NOT NULL,
  "creator_display_name_yomi" text,
  "creator_icon_url" text,
  "creator_youtube_channel_url" text,
  "title" text NOT NULL,
  "music" text,
  "credit" text,
  "music_reference_url" text,
  "closing_comment" text,
  "youtube_video_id" text,
  "intro_comment" text,
  "highlights" text,
  "production_story" text,
  "visibility_status" text NOT NULL DEFAULT 'draft' CHECK ("visibility_status" IN ('draft', 'pending', 'public', 'limited', 'private', 'archived', 'voided')),
  "scheduling_type" text DEFAULT 'slotted' CHECK ("scheduling_type" IN ('slotted', 'manual')),
  "scheduled_time" integer,
  "app_like_count" integer NOT NULL DEFAULT 0,
  "score" real NOT NULL DEFAULT 0,
  "score_updated_at" integer,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY ("creator_x_user_id") REFERENCES "x_users" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "user" ("id") ON DELETE RESTRICT
);
CREATE INDEX "videos_visibility_status_idx" ON "videos" ("visibility_status");
CREATE INDEX "videos_scheduled_idx" ON "videos" ("scheduled_time");
CREATE INDEX "videos_primary_event_idx" ON "videos" ("primary_event_id");
CREATE INDEX "videos_submitted_by_idx" ON "videos" ("submitted_by_user_id");
CREATE INDEX "videos_creator_x_idx" ON "videos" ("creator_x_user_id");
CREATE INDEX "videos_youtube_id_idx" ON "videos" ("youtube_video_id");
CREATE UNIQUE INDEX "videos_youtube_id_active_uniq" ON "videos" ("youtube_video_id") WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> '' AND visibility_status NOT IN ('archived', 'voided');

CREATE TABLE "worker_leases" (
  "job_name" text PRIMARY KEY NOT NULL,
  "lease_token" text NOT NULL,
  "lease_expires_at" integer NOT NULL,
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "x_account_link_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "requested_x_id" text NOT NULL,
  "link_type" text NOT NULL CHECK ("link_type" IN ('new', 'merge', 'alias')),
  "target_x_user_id" text,
  "status" text DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
  "requested_at" integer NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "x_id_merge_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "from_x_user_id" text NOT NULL,
  "to_x_user_id" text NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "status" text DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'done')),
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  FOREIGN KEY ("requested_by_user_id") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE TABLE "x_id_merge_reverts" (
  "id" text PRIMARY KEY NOT NULL,
  "merge_request_id" text NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "status" text DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'done')),
  "restore_snapshot_json" text NOT NULL,
  "revert_deadline_at" integer NOT NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  FOREIGN KEY ("requested_by_user_id") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE TABLE "x_user_aliases" (
  "x_user_id" text NOT NULL,
  "alias_x_id" text NOT NULL,
  PRIMARY KEY ("x_user_id", "alias_x_id")
);

CREATE TABLE "x_user_icons" (
  "id" text PRIMARY KEY NOT NULL,
  "x_user_id" text NOT NULL,
  "icon_url" text NOT NULL,
  "source_video_id" text,
  "source_type" text DEFAULT 'video' CHECK ("source_type" IN ('video', 'manual', 'legacy')),
  "created_at" integer NOT NULL
);
CREATE UNIQUE INDEX "x_user_icons_user_url_uniq" ON "x_user_icons" ("x_user_id", "icon_url");
CREATE INDEX "x_user_icons_user_created_idx" ON "x_user_icons" ("x_user_id", "created_at");

CREATE TABLE "x_user_youtube_channels" (
  "id" text PRIMARY KEY NOT NULL,
  "x_user_id" text NOT NULL,
  "youtube_channel_url" text NOT NULL,
  "source_video_id" text,
  "source_type" text NOT NULL DEFAULT 'video' CHECK ("source_type" IN ('video', 'manual', 'legacy')),
  "created_at" integer NOT NULL
);
CREATE UNIQUE INDEX "x_user_youtube_channels_user_url_uniq" ON "x_user_youtube_channels" ("x_user_id", "youtube_channel_url");
CREATE INDEX "x_user_youtube_channels_user_created_idx" ON "x_user_youtube_channels" ("x_user_id", "created_at");

CREATE TABLE "x_users" (
  "id" text PRIMARY KEY NOT NULL,
  "x_name" text NOT NULL,
  "icon_url" text,
  "profile_text" text,
  "portfolio_contact" text,
  "youtube_channel_url" text,
  "other_social_links" text,
  "creative_start_date" integer,
  "linked_user_id" text,
  "verification_token" text,
  "token_expires_at" integer,
  "approval_status" text DEFAULT 'pending' CHECK ("approval_status" IN ('pending', 'approved', 'rejected')),
  "approval_requested_at" integer,
  FOREIGN KEY ("linked_user_id") REFERENCES "user" ("id") ON DELETE SET NULL
);

INSERT INTO "flamenode_schema_meta" ("id", "version", "applied_at")
VALUES ('current', '2026-07-11-baseline-1', unixepoch());

INSERT INTO "system_settings" ("id", "operation_mode", "auto_cost_guard_enabled", "history_retention_days")
VALUES ('default', 'normal', 0, 90);
