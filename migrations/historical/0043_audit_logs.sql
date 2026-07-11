-- 監査ログ・リストア実行履歴・監査ログ設定テーブルの追加

CREATE TABLE `audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `table_name` text NOT NULL,
  `target_id` text NOT NULL,
  `operation` text NOT NULL,
  `before_json` text,
  `after_json` text,
  `changed_keys_json` text,
  `inverse_patch_json` text,
  `actor_user_id` text NOT NULL,
  `actor_snapshot_json` text,
  `reason` text,
  `context` text,
  `retention_class` text NOT NULL DEFAULT 'normal',
  `restore_strategy` text NOT NULL DEFAULT 'none',
  `restore_status` text NOT NULL DEFAULT 'not_restorable',
  `payload_size_bytes` integer NOT NULL DEFAULT 0,
  `expires_at` integer,
  `created_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

CREATE INDEX `audit_logs_table_target_idx` ON `audit_logs` (`table_name`, `target_id`);
--> statement-breakpoint

CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`, `created_at`);
--> statement-breakpoint

CREATE INDEX `audit_logs_restore_status_idx` ON `audit_logs` (`restore_status`);
--> statement-breakpoint

CREATE INDEX `audit_logs_expires_idx` ON `audit_logs` (`expires_at`);
--> statement-breakpoint

CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);
--> statement-breakpoint

CREATE INDEX `audit_logs_operation_idx` ON `audit_logs` (`operation`, `created_at`);
--> statement-breakpoint

CREATE TABLE `audit_restore_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `audit_log_id` text NOT NULL,
  `executed_by_user_id` text NOT NULL,
  `reason` text NOT NULL,
  `status` text NOT NULL,
  `error_message` text,
  `executed_at` integer NOT NULL
);
--> statement-breakpoint

CREATE INDEX `audit_restore_runs_log_idx` ON `audit_restore_runs` (`audit_log_id`);
--> statement-breakpoint

CREATE INDEX `audit_restore_runs_user_idx` ON `audit_restore_runs` (`executed_by_user_id`);
--> statement-breakpoint

CREATE INDEX `audit_restore_runs_executed_at_idx` ON `audit_restore_runs` (`executed_at`);
--> statement-breakpoint

CREATE TABLE `audit_log_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `normal_retention_days` integer NOT NULL DEFAULT 30,
  `restorable_retention_days` integer NOT NULL DEFAULT 180,
  `long_audit_retention_days` integer NOT NULL DEFAULT 365,
  `max_payload_bytes` integer NOT NULL DEFAULT 20000,
  `compact_after_days` integer NOT NULL DEFAULT 30,
  `updated_by_user_id` text,
  `updated_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

INSERT OR IGNORE INTO `audit_log_settings` (
  `id`,
  `normal_retention_days`,
  `restorable_retention_days`,
  `long_audit_retention_days`,
  `max_payload_bytes`,
  `compact_after_days`,
  `updated_by_user_id`,
  `updated_at`
) VALUES (
  'default',
  30,
  180,
  365,
  20000,
  30,
  NULL,
  unixepoch()
);
