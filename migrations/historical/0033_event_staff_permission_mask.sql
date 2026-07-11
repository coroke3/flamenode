-- 0033: Move event staff permissions to event_staff permission_mask columns.
-- event_staff_permissions remains as a migration source only.

ALTER TABLE `event_staff` ADD `permission_preset` text NOT NULL DEFAULT 'public_staff';
ALTER TABLE `event_staff` ADD `permission_mask` integer NOT NULL DEFAULT 0;
ALTER TABLE `event_staff` ADD `custom_permission_keys_json` text;

UPDATE `event_staff`
SET `permission_preset` = CASE
  WHEN `role` = 'representative' THEN 'owner'
  WHEN `role` = 'editor' THEN 'manager'
  ELSE 'public_staff'
END;

UPDATE `event_staff`
SET `permission_mask` = CASE `permission_preset`
  WHEN 'owner' THEN 64639
  WHEN 'manager' THEN 64631
  WHEN 'slot_manager' THEN 4
  WHEN 'content_editor' THEN 31744
  WHEN 'reviewer' THEN 32800
  WHEN 'xid_reviewer' THEN 512
  ELSE 0
END;

UPDATE `event_staff`
SET
  `permission_preset` = 'custom',
  `permission_mask` = COALESCE((
    SELECT SUM(DISTINCT CASE `permission_key`
      WHEN 'event.basic' THEN 1
      WHEN 'event.publish' THEN 2
      WHEN 'event.slots' THEN 4
      WHEN 'event.members' THEN 8
      WHEN 'event.questions' THEN 16
      WHEN 'event.review' THEN 32
      WHEN 'event.notifications' THEN 64
      WHEN 'event.public_api' THEN 128
      WHEN 'event.static_rebuild' THEN 256
      WHEN 'xid.link_requests' THEN 512
      WHEN 'video.basics' THEN 1024
      WHEN 'videos.title' THEN 1024
      WHEN 'video.descriptions' THEN 2048
      WHEN 'videos.review_data' THEN 2048
      WHEN 'video.credits' THEN 4096
      WHEN 'videos.music_credit' THEN 4096
      WHEN 'video.members' THEN 8192
      WHEN 'videos.members' THEN 8192
      WHEN 'video.member_chapters' THEN 16384
      WHEN 'video.chapter_admin' THEN 16384
      WHEN 'video.status' THEN 32768
      WHEN 'video.primary_event' THEN 65536
      WHEN 'videos.primary_event' THEN 65536
      WHEN 'video.youtube_id' THEN 131072
      WHEN 'videos.youtube_id' THEN 131072
      WHEN 'video.identity' THEN 262144
      ELSE 0
    END)
    FROM `event_staff_permissions`
    WHERE `event_staff_permissions`.`event_staff_id` = `event_staff`.`id`
      AND `event_staff_permissions`.`allowed` = 1
  ), 0),
  `custom_permission_keys_json` = (
    SELECT
      CASE
        WHEN COUNT(`canonical_key`) = 0 THEN NULL
        ELSE '[' || group_concat('"' || `canonical_key` || '"') || ']'
      END
    FROM (
      SELECT DISTINCT CASE `permission_key`
        WHEN 'event.basic' THEN 'event.basic'
        WHEN 'event.publish' THEN 'event.publish'
        WHEN 'event.slots' THEN 'event.slots'
        WHEN 'event.members' THEN 'event.members'
        WHEN 'event.questions' THEN 'event.questions'
        WHEN 'event.review' THEN 'event.review'
        WHEN 'event.notifications' THEN 'event.notifications'
        WHEN 'event.public_api' THEN 'event.public_api'
        WHEN 'event.static_rebuild' THEN 'event.static_rebuild'
        WHEN 'xid.link_requests' THEN 'xid.link_requests'
        WHEN 'video.basics' THEN 'video.basics'
        WHEN 'videos.title' THEN 'video.basics'
        WHEN 'video.descriptions' THEN 'video.descriptions'
        WHEN 'videos.review_data' THEN 'video.descriptions'
        WHEN 'video.credits' THEN 'video.credits'
        WHEN 'videos.music_credit' THEN 'video.credits'
        WHEN 'video.members' THEN 'video.members'
        WHEN 'videos.members' THEN 'video.members'
        WHEN 'video.member_chapters' THEN 'video.member_chapters'
        WHEN 'video.chapter_admin' THEN 'video.member_chapters'
        WHEN 'video.status' THEN 'video.status'
        WHEN 'video.primary_event' THEN 'video.primary_event'
        WHEN 'videos.primary_event' THEN 'video.primary_event'
        WHEN 'video.youtube_id' THEN 'video.youtube_id'
        WHEN 'videos.youtube_id' THEN 'video.youtube_id'
        WHEN 'video.identity' THEN 'video.identity'
        ELSE NULL
      END AS `canonical_key`
      FROM `event_staff_permissions`
      WHERE `event_staff_permissions`.`event_staff_id` = `event_staff`.`id`
        AND `event_staff_permissions`.`allowed` = 1
    )
    WHERE `canonical_key` IS NOT NULL
  )
WHERE `role` = 'staff'
  AND EXISTS (
    SELECT 1
    FROM `event_staff_permissions`
    WHERE `event_staff_permissions`.`event_staff_id` = `event_staff`.`id`
      AND `event_staff_permissions`.`allowed` = 1
  );

CREATE INDEX IF NOT EXISTS `event_staff_event_idx` ON `event_staff` (`event_id`);
CREATE INDEX IF NOT EXISTS `event_staff_public_idx` ON `event_staff` (`event_id`, `is_public`, `display_name`);
CREATE INDEX IF NOT EXISTS `event_staff_permission_idx` ON `event_staff` (`event_id`, `permission_mask`) WHERE `permission_mask` <> 0;
CREATE INDEX IF NOT EXISTS `x_users_linked_approved_idx` ON `x_users` (`linked_discord_user_id`, `approval_status`, `id`);
