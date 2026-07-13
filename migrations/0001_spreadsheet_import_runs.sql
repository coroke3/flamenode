-- Migration: 0001_spreadsheet_import_runs.sql
-- Date: 2026-07-13
-- Type: additive
-- Summary: Spreadsheet import previewの署名nonceを一度だけ原子的に消費する短期runを追加
-- Data loss: none
-- Rollback: manual
-- Change log: docs/database/change-log.md

CREATE TABLE "spreadsheet_import_runs" (
  "nonce" text PRIMARY KEY NOT NULL,
  "operator_user_id" text NOT NULL,
  "table_name" text NOT NULL,
  "mode" text NOT NULL,
  "payload_hash" text NOT NULL,
  "schema_fingerprint" text NOT NULL,
  "expires_at" integer NOT NULL,
  "consumed_at" integer,
  "created_at" integer NOT NULL,
  FOREIGN KEY ("operator_user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  CONSTRAINT "spreadsheet_import_runs_nonce_check" CHECK (length("nonce") = 36 AND substr("nonce", 9, 1) = '-' AND substr("nonce", 14, 1) = '-' AND substr("nonce", 19, 1) = '-' AND substr("nonce", 24, 1) = '-' AND "nonce" NOT GLOB '*[^0-9a-f-]*'),
  CONSTRAINT "spreadsheet_import_runs_table_name_check" CHECK (length("table_name") BETWEEN 1 AND 128),
  CONSTRAINT "spreadsheet_import_runs_mode_check" CHECK ("mode" IN ('insert', 'upsert')),
  CONSTRAINT "spreadsheet_import_runs_payload_hash_check" CHECK (length("payload_hash") = 64 AND "payload_hash" NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT "spreadsheet_import_runs_schema_hash_check" CHECK (length("schema_fingerprint") = 64 AND "schema_fingerprint" NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT "spreadsheet_import_runs_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "spreadsheet_import_runs_consumed_check" CHECK ("consumed_at" IS NULL OR "consumed_at" >= "created_at")
);

CREATE INDEX "spreadsheet_import_runs_expires_idx" ON "spreadsheet_import_runs" ("expires_at");
CREATE INDEX "spreadsheet_import_runs_consumed_expires_idx" ON "spreadsheet_import_runs" ("consumed_at", "expires_at");
CREATE INDEX "spreadsheet_import_runs_operator_created_idx" ON "spreadsheet_import_runs" ("operator_user_id", "created_at");
