-- 0029: Add operation_mode column to system_settings
-- operation_mode is the canonical source for site-wide operation state.
-- cost_guard_mode is kept for backward compatibility but operation_mode takes precedence.

ALTER TABLE `system_settings` ADD `operation_mode` text DEFAULT 'normal';

-- Migrate existing cost_guard_mode values to operation_mode
UPDATE `system_settings` SET `operation_mode` = `cost_guard_mode` WHERE `cost_guard_mode` IS NOT NULL;

-- Migrate is_maintenance_mode = 1 to operation_mode = 'maintenance'
UPDATE `system_settings` SET `operation_mode` = 'maintenance' WHERE `is_maintenance_mode` = 1;
