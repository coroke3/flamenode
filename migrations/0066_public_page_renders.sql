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
  PRIMARY KEY (entity, entity_id)
);
