-- 0034: Add user-level event creation permission flag.
-- Event request flows are intentionally not created here.

ALTER TABLE `user` ADD `can_create_events` integer NOT NULL DEFAULT 0;
