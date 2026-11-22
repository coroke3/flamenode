-- Migration: 0067_x_user_canonical_lookup_indexes.sql
-- Date: 2026-11-22
-- Type: additive
-- Review gate: independent DB schema and nonproduction D1 verification required
-- Summary: index the *exact* canonical resolver and in-batch CAS normalization
-- Data loss: none
-- Data rewrite: none; no uniqueness assumption on legacy aliases
-- Rollback: DROP INDEX IF EXISTS x_user_aliases_canonical_norm_alias_idx;
--           DROP INDEX IF EXISTS x_users_canonical_norm_id_idx;
-- Change log: docs/database/change-log.d/0067_x_user_canonical_lookup_indexes.md

-- Do not substitute the existing x_users_lower_id_idx: trim/@ normalization
-- changes the expression and SQLite cannot use lower(id) for that predicate.
CREATE INDEX IF NOT EXISTS x_users_canonical_norm_id_idx
  ON x_users (lower(trim(ltrim(trim(id), '@'))));

-- Alias ownership has composite PK (x_user_id,alias_x_id); it is NOT a
-- globally unique normalized alias. Keep index non-unique and let canonical
-- resolver reject ambiguous/retargeted aliases, preserving CURRENT policy.
CREATE INDEX IF NOT EXISTS x_user_aliases_canonical_norm_alias_idx
  ON x_user_aliases (lower(trim(ltrim(trim(alias_x_id), '@'))));
