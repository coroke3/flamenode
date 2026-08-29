-- Migration: 0061_event_required_video_fields.sql
-- Date: 2026-08-29
-- Type: additive
-- Summary: add an optional per-event JSON allow-list of required video form fields
-- Data loss: none
-- Rollback: manual (restore from backup; no destructive rollback is used)
-- Change log: docs/database/change-log.d/0061_event_required_video_fields.md

ALTER TABLE events ADD COLUMN required_video_fields_json TEXT;
