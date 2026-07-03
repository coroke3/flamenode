-- 0038: Normalize permission_preset from permission_mask when keys exactly match a preset.
-- Rows with no permissions (mask 0) become public_staff; non-matching masks stay custom.

UPDATE `event_staff`
SET
  `permission_preset` = 'owner',
  `custom_permission_keys_json` = NULL
WHERE `permission_mask` = 64639;

UPDATE `event_staff`
SET
  `permission_preset` = 'manager',
  `custom_permission_keys_json` = NULL
WHERE `permission_mask` = 64631;

UPDATE `event_staff`
SET
  `permission_preset` = 'slot_manager',
  `custom_permission_keys_json` = NULL
WHERE `permission_mask` = 4;

UPDATE `event_staff`
SET
  `permission_preset` = 'content_editor',
  `custom_permission_keys_json` = NULL
WHERE `permission_mask` = 31744;

UPDATE `event_staff`
SET
  `permission_preset` = 'reviewer',
  `custom_permission_keys_json` = NULL
WHERE `permission_mask` = 32800;

UPDATE `event_staff`
SET
  `permission_preset` = 'xid_reviewer',
  `custom_permission_keys_json` = NULL
WHERE `permission_mask` = 512;

UPDATE `event_staff`
SET
  `permission_preset` = 'public_staff',
  `custom_permission_keys_json` = NULL
WHERE `permission_mask` = 0;

CREATE INDEX IF NOT EXISTS `x_users_linked_approved_idx` ON `x_users` (`linked_discord_user_id`, `approval_status`, `id`);
