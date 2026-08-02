-- Pending contract: slot reservation groups dual-write cleanup
-- Apply only after check:slot-reservation-groups reports zero unresolved rows
-- and backfill-slot-reservation-groups has completed.
-- Do NOT place in migrations/ until expand validation passes.

-- Example future steps (not applied automatically):
-- 1. Verify slots.reservation_group_id references slot_reservation_groups.id
-- 2. Stop writing reserved_by_user_id / x_user_id / display_name on slots
-- 3. Drop redundant slot columns after all readers migrate
