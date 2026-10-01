-- Migration: 0063_event_staff_account_lookup_index.sql
-- Date: 2026-09-30
-- Type: additive
-- Summary: index account management lookups by approved X identity
-- Data loss: none
-- Rollback: DROP INDEX IF EXISTS event_staff_x_event_idx
-- Change log: docs/database/change-log.d/0063_event_staff_account_lookup_index.md

CREATE INDEX IF NOT EXISTS event_staff_x_event_idx
ON event_staff (x_user_id, event_id);
