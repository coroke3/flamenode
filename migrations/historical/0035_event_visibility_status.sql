-- 0035: Add canonical event visibility status.
-- Legacy flags remain for compatibility; visibility_status takes precedence.

ALTER TABLE `events` ADD `visibility_status` text NOT NULL DEFAULT 'draft';

UPDATE `events`
SET `visibility_status` = CASE
  WHEN `is_archived` = 1 THEN 'archived'
  WHEN `is_active` = 1 THEN 'public'
  ELSE 'draft'
END;

CREATE INDEX IF NOT EXISTS `events_visibility_status_idx`
  ON `events` (`visibility_status`, `start_time`, `end_time`);
