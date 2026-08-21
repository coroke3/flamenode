-- Event-scoped X ID reservation limits and slot interval guidance.
-- Existing events remain unlimited (0) and interval auto-detection remains enabled (NULL).

ALTER TABLE events
  ADD COLUMN max_slot_reservation_groups_per_xid INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN slot_interval_minutes INTEGER;

-- Hot-path index for the server-side logical reservation count guard.
-- The guard counts one reservation_group_id as one logical reservation and
-- legacy/null group rows by slot id. It only runs on reserve mutations, never
-- in proportion to public page traffic.
CREATE INDEX IF NOT EXISTS slots_event_x_snapshot_active_group_idx
  ON slots(
    event_id,
    reserved_x_id_snapshot,
    status,
    reservation_group_id,
    id
  )
  WHERE reserved_x_id_snapshot IS NOT NULL
    AND status IN ('reserved', 'submitted');
