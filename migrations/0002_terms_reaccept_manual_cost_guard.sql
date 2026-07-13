-- Migration: 0002_terms_reaccept_manual_cost_guard.sql
-- Date: 2026-07-13
-- Type: destructive cleanup + additive indexes
-- Summary: 利用規約再同意の索引/FKを追加し、未計測の自動CostGuard正本を削除する
-- Data loss: cost_usage_snapshots と未使用の自動判定設定2列を削除
-- Rollback: migration前のD1 backupから手動復元
-- Change log: docs/db-change-history.md

DROP TABLE IF EXISTS "cost_usage_snapshots";

ALTER TABLE "system_settings" DROP COLUMN "auto_cost_guard_enabled";
ALTER TABLE "system_settings" DROP COLUMN "cost_guard_thresholds_json";

CREATE TABLE "user_tos_consents_next" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "terms_version_id" text NOT NULL,
  "consented_at" integer NOT NULL,
  "consent_context" text NOT NULL CHECK (
    "consent_context" IN ('entry', 'post', 'edit', 'admin')
  ),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

INSERT INTO "user_tos_consents_next" (
  "id", "user_id", "terms_version_id", "consented_at", "consent_context"
)
SELECT
  "id", "user_id", "terms_version_id", "consented_at", "consent_context"
FROM "user_tos_consents";

DROP TABLE "user_tos_consents";
ALTER TABLE "user_tos_consents_next" RENAME TO "user_tos_consents";

CREATE INDEX "user_tos_consents_user_terms_idx"
  ON "user_tos_consents" ("user_id", "terms_version_id");
CREATE INDEX "terms_versions_severity_published_idx"
  ON "terms_versions" ("severity", "published_at", "updated_at");
CREATE INDEX "user_tos_reaccept_scan_idx"
  ON "user" ("is_tos_accepted", "id");
CREATE INDEX "user_tos_notify_scan_idx"
  ON "user" ("is_notification_enabled", "is_tos_accepted", "id");
