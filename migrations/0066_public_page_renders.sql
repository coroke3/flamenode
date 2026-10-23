-- Migration: 0066_public_page_renders.sql
-- Date: 2026-10-18
-- Type: additive
-- Summary: add public_page_renders table to track queue-driven page generation (MIG-0411)
-- Data loss: none
-- Rollback: DROP TABLE IF EXISTS public_page_renders
-- Change log: docs/database/change-log.d/0066_public_page_renders.md

CREATE TABLE public_page_renders (
  entity TEXT NOT NULL CHECK (entity IN ('video', 'user', 'event')),
  entity_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  rendered_at INTEGER NOT NULL DEFAULT 0,
  -- Monotonic request counter: every producer upsert adds 1. The consumer's CAS and the
  -- pending test compare versions, never timestamps from different clocks, so two edits
  -- in the same millisecond (or a producer clock behind the consumer) are not lost.
  request_version INTEGER NOT NULL DEFAULT 1,
  rendered_version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity, entity_id)
);
-- Recovery reads pending rows only (request_version > rendered_version); without this
-- partial index the bounded LIMIT query would still scan every rendered page.
CREATE INDEX public_page_renders_pending_idx
  ON public_page_renders (requested_at)
  WHERE request_version > rendered_version;
