-- 0030: Add usage_count, is_active, is_verified to software_catalog

ALTER TABLE `software_catalog` ADD `usage_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `software_catalog` ADD `is_active` integer NOT NULL DEFAULT 1;
ALTER TABLE `software_catalog` ADD `is_verified` integer NOT NULL DEFAULT 0;
