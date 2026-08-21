-- Event-scoped X ID reservation limits and slot interval guidance.
-- Existing events remain unlimited (0) and interval auto-detection remains enabled (NULL).

ALTER TABLE events
  ADD COLUMN max_slot_reservation_groups_per_xid INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN slot_interval_minutes INTEGER;

CREATE TABLE IF NOT EXISTS slot_reservation_subject_counts (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  x_id_snapshot TEXT NOT NULL,
  reservation_count INTEGER NOT NULL DEFAULT 0 CHECK (reservation_count >= 0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (event_id, x_id_snapshot)
);

-- Backfill one logical reservation per reservation_group_id, or per slot when legacy/null.
INSERT INTO slot_reservation_subject_counts (
  event_id,
  x_id_snapshot,
  reservation_count,
  updated_at
)
SELECT
  event_id,
  reserved_x_id_snapshot,
  COUNT(DISTINCT CASE
    WHEN reservation_group_id IS NOT NULL AND reservation_group_id <> ''
      THEN 'group:' || reservation_group_id
    ELSE 'slot:' || id
  END),
  unixepoch()
FROM slots
WHERE status IN ('reserved', 'submitted')
  AND reserved_x_id_snapshot IS NOT NULL
  AND TRIM(reserved_x_id_snapshot) <> ''
GROUP BY event_id, reserved_x_id_snapshot
ON CONFLICT(event_id, x_id_snapshot) DO UPDATE SET
  reservation_count = excluded.reservation_count,
  updated_at = excluded.updated_at;

CREATE INDEX IF NOT EXISTS slots_event_x_snapshot_active_group_idx
  ON slots(event_id, reserved_x_id_snapshot, status, reservation_group_id)
  WHERE reserved_x_id_snapshot IS NOT NULL
    AND status IN ('reserved', 'submitted');
