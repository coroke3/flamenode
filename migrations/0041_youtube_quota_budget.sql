-- Migration: 0041_youtube_quota_budget.sql
-- Date: 2026-07-13
-- Type: additive
-- Summary: 単一YouTube APIキーの日次quota使用量を原子的に管理する
-- Data loss: none
-- Rollback: DROP TABLE IF EXISTS external_api_quota_usage;
-- Change log: docs/database/change-log.md

CREATE TABLE external_api_quota_usage (
  provider TEXT NOT NULL,
  quota_day TEXT NOT NULL,
  used_units INTEGER NOT NULL DEFAULT 0 CHECK (used_units >= 0),
  limit_units INTEGER NOT NULL CHECK (limit_units > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, quota_day)
);
