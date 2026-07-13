-- Migration: 0003_large_collaboration_support.sql
-- Date: 2026-07-13
-- Type: additive
-- Summary: Raise audit_log_settings max_payload_bytes for large collaboration member sets
-- Data loss: none
-- Rollback: recreate audit_log_settings with max_payload_bytes DEFAULT 20000 and restore prior row values from backup
-- Change log: docs/database/change-log.md

UPDATE audit_log_settings
SET max_payload_bytes = 120000
WHERE id = 'default'
  AND max_payload_bytes < 120000;

CREATE TABLE "audit_log_settings_next" (
  "id" text PRIMARY KEY NOT NULL,
  "normal_retention_days" integer NOT NULL DEFAULT 30,
  "restorable_retention_days" integer NOT NULL DEFAULT 180,
  "long_audit_retention_days" integer NOT NULL DEFAULT 365,
  "max_payload_bytes" integer NOT NULL DEFAULT 120000,
  "compact_after_days" integer NOT NULL DEFAULT 30,
  "updated_by_user_id" text,
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);

INSERT INTO "audit_log_settings_next" (
  "id",
  "normal_retention_days",
  "restorable_retention_days",
  "long_audit_retention_days",
  "max_payload_bytes",
  "compact_after_days",
  "updated_by_user_id",
  "updated_at"
)
SELECT
  "id",
  "normal_retention_days",
  "restorable_retention_days",
  "long_audit_retention_days",
  "max_payload_bytes",
  "compact_after_days",
  "updated_by_user_id",
  "updated_at"
FROM "audit_log_settings";

DROP TABLE "audit_log_settings";
ALTER TABLE "audit_log_settings_next" RENAME TO "audit_log_settings";
