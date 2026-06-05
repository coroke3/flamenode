-- 公開用静的 JSON の編集駆動再生成キュー
CREATE TABLE `static_rebuild_queue` (
  `id` text PRIMARY KEY NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `reason` text,
  `priority` text NOT NULL DEFAULT 'normal',
  `status` text NOT NULL DEFAULT 'pending',
  `attempt_count` integer NOT NULL DEFAULT 0,
  `requested_by_user_id` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch()),
  `processing_started_at` integer,
  `processed_at` integer,
  `next_retry_at` integer,
  `error` text
);

CREATE UNIQUE INDEX `static_rebuild_queue_target_pending_uniq`
ON `static_rebuild_queue`(`target_type`, `target_id`)
WHERE `status` IN ('pending', 'processing');

CREATE INDEX `static_rebuild_queue_status_priority_idx`
ON `static_rebuild_queue`(`status`, `priority`, `created_at`);

CREATE INDEX `static_rebuild_queue_next_retry_idx`
ON `static_rebuild_queue`(`status`, `next_retry_at`);
