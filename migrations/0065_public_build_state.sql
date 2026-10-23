-- Migration: 0065_public_build_state.sql
-- Date: 2026-10-17
-- Type: additive
-- Summary: add public_build_state table to track public data rebuild requests and deploy hooks
-- Data loss: none
-- Rollback: DROP TABLE IF EXISTS public_build_state
-- Change log: docs/database/change-log.d/0065_public_build_state.md

CREATE TABLE public_build_state (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  requested_at INTEGER NOT NULL DEFAULT 0,
  last_hook_at INTEGER NOT NULL DEFAULT 0,
  hooks_day TEXT NOT NULL DEFAULT '',
  hooks_today INTEGER NOT NULL DEFAULT 0
);
INSERT INTO public_build_state (id) VALUES (1);
