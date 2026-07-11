-- Pre-production slot schema cleanup for start_time-based continuous slot logic.
-- Slot end time is no longer a data concept; adjacent starts and part gap define continuity.
-- Singleton reservation_group_id rows (group of 1) are also cleared.

ALTER TABLE slots DROP COLUMN end_time;
--> statement-breakpoint
UPDATE slots
SET reservation_group_id = NULL
WHERE reservation_group_id IS NOT NULL
  AND reservation_group_id IN (
    SELECT reservation_group_id
    FROM slots
    WHERE reservation_group_id IS NOT NULL
    GROUP BY reservation_group_id
    HAVING COUNT(*) = 1
  );
