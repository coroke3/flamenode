-- Migration: 0060_youtube_sync_notification_observability.sql
-- Date: 2026-08-24
-- Type: additive
-- Summary: add playlist run history, incident state, and route-aware notification outbox compatibility
-- Data loss: none; notification rows are copied before the old table is replaced
-- Rollback: restore from a verified D1 backup; drop additive tables/indexes only after rollback verification
-- Change log: docs/database/change-log.d/0060_youtube_sync_notification_observability.md

PRAGMA defer_foreign_keys = ON;

ALTER TABLE event_youtube_playlist_sync
  ADD COLUMN last_attempt_at INTEGER;

ALTER TABLE event_youtube_playlist_sync
  ADD COLUMN last_run_id TEXT;

ALTER TABLE event_youtube_playlist_sync
  ADD COLUMN last_duration_ms INTEGER;

ALTER TABLE event_youtube_playlist_sync
  ADD COLUMN run_lease_token TEXT;

ALTER TABLE event_youtube_playlist_sync
  ADD COLUMN run_lease_expires_at INTEGER;

ALTER TABLE event_youtube_playlist_sync
  ADD COLUMN pending_trigger TEXT
  CHECK (pending_trigger IS NULL OR pending_trigger IN ('manual', 'settings_change', 'continuation', 'scheduled'));

CREATE TABLE event_youtube_playlist_sync_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  playlist_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'settings_change', 'continuation', 'scheduled')),
  dispatch_source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'deferred', 'skipped')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  detail_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX event_youtube_playlist_sync_runs_event_started_idx
  ON event_youtube_playlist_sync_runs(event_id, started_at DESC, run_id);

CREATE INDEX event_youtube_playlist_sync_runs_created_idx
  ON event_youtube_playlist_sync_runs(created_at DESC, run_id);

CREATE TABLE ops_incident_state (
  incident_key TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  fingerprint TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_notified_at INTEGER,
  last_correlation_id TEXT,
  resolved_at INTEGER
);

CREATE INDEX ops_incident_state_state_seen_idx
  ON ops_incident_state(state, last_seen_at DESC, incident_key);

CREATE INDEX ops_incident_state_fingerprint_idx
  ON ops_incident_state(fingerprint);

-- notification_outbox historically required a user for every row. Rebuild it
-- so channel/webhook rows can safely be recipient-less while preserving every
-- existing column, status, lease, retry, event, and dedupe value.
CREATE TABLE _migration_0060_notification_outbox_expected (
  row_count INTEGER NOT NULL
);

INSERT INTO _migration_0060_notification_outbox_expected (row_count)
SELECT COUNT(*) FROM notification_outbox;

CREATE TABLE notification_outbox_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  recipient_user_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  delivery_route TEXT,
  correlation_id TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'dead_letter')),
  attempt_count INTEGER DEFAULT 0,
  processing_started_at INTEGER,
  lease_token TEXT,
  lease_expires_at INTEGER,
  next_attempt_at INTEGER,
  last_error TEXT,
  processed_at INTEGER,
  event_id TEXT,
  dedupe_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CONSTRAINT notification_outbox_delivery_route_ck CHECK (
    delivery_route IS NULL OR (
      delivery_route IN ('dm', 'channel')
      AND (delivery_route = 'channel' OR recipient_user_id IS NOT NULL)
    )
  ),
  FOREIGN KEY (recipient_user_id) REFERENCES user(id) ON DELETE RESTRICT
);

INSERT INTO notification_outbox_v2 (
  id, recipient_user_id, type, payload_json, delivery_route, correlation_id,
  status, attempt_count, processing_started_at, lease_token, lease_expires_at,
  next_attempt_at, last_error, processed_at, event_id, dedupe_key, created_at
)
SELECT
  id,
  recipient_user_id,
  type,
  payload_json,
  CASE WHEN type = 'discord_webhook' THEN 'channel' ELSE 'dm' END,
  NULL,
  status,
  attempt_count,
  processing_started_at,
  lease_token,
  lease_expires_at,
  next_attempt_at,
  last_error,
  processed_at,
  event_id,
  dedupe_key,
  created_at
FROM notification_outbox;

DROP TABLE notification_outbox;
ALTER TABLE notification_outbox_v2 RENAME TO notification_outbox;

CREATE TABLE _migration_0060_notification_outbox_check (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _migration_0060_notification_outbox_check (ok)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM notification_outbox) =
       (SELECT row_count FROM _migration_0060_notification_outbox_expected)
  THEN 1 ELSE 0 END;

DROP TABLE _migration_0060_notification_outbox_check;
DROP TABLE _migration_0060_notification_outbox_expected;

CREATE INDEX notification_outbox_status_created_idx
  ON notification_outbox(status, created_at);
CREATE INDEX notification_outbox_created_idx
  ON notification_outbox(created_at DESC);
CREATE INDEX notification_outbox_processing_started_idx
  ON notification_outbox(status, processing_started_at);
CREATE INDEX notification_outbox_lease_idx
  ON notification_outbox(status, lease_expires_at);
CREATE INDEX notification_outbox_event_idx
  ON notification_outbox(event_id);
CREATE INDEX notification_outbox_route_status_idx
  ON notification_outbox(delivery_route, status, created_at);
CREATE INDEX notification_outbox_dedupe_idx
  ON notification_outbox(dedupe_key);
CREATE INDEX notification_outbox_status_dedupe_idx
  ON notification_outbox(status, dedupe_key);
CREATE UNIQUE INDEX notification_outbox_active_dedupe_uniq
  ON notification_outbox(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'processing', 'sent');

PRAGMA optimize;

UPDATE flamenode_schema_meta
   SET version = '2026-08-24-observability-1'
 WHERE id = 'current';
