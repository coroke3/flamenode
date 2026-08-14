-- Migration: 0058_event_youtube_description_template.sql
-- Date: 2026-08-15
-- Type: additive
-- Summary: add an optional per-event YouTube description template
-- Data loss: none
-- Rollback: manual (restore from backup; no destructive rollback is used)
-- Change log: docs/database/change-log.md

ALTER TABLE events ADD COLUMN youtube_description_template TEXT;
