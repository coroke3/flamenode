-- Migration: 0064_x_users_lower_id_index.sql
-- Date: 2026-10-03
-- Type: additive
-- Summary: add an expression index so lower(x_users.id) lookups are index-backed
-- Data loss: none
-- Rollback: DROP INDEX IF EXISTS x_users_lower_id_idx
-- Change log: docs/database/change-log.d/0064_x_users_lower_id_index.md

CREATE INDEX IF NOT EXISTS x_users_lower_id_idx
ON x_users (lower(id));
