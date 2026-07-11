-- 0027: Add event_custom_questions and video_custom_answers tables
-- Normalized tables for event-scoped custom questions and per-video answers.
-- The existing JSON columns (events.custom_questions, videos.custom_answers)
-- are kept for backward compatibility but are NOT used by the new feature.

CREATE TABLE IF NOT EXISTS `event_custom_questions` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `question_key` text NOT NULL,
  `label` text NOT NULL,
  `description` text,
  `type` text NOT NULL DEFAULT 'textarea',
  `required` integer NOT NULL DEFAULT 0,
  `options_json` text,
  `placeholder` text,
  `max_length` integer,
  `sort_order` integer NOT NULL DEFAULT 0,
  `is_active` integer NOT NULL DEFAULT 1,
  `visibility` text NOT NULL DEFAULT 'review',
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS `event_custom_questions_event_key_uniq`
  ON `event_custom_questions` (`event_id`, `question_key`);

CREATE INDEX IF NOT EXISTS `event_custom_questions_event_sort_idx`
  ON `event_custom_questions` (`event_id`, `sort_order`);

CREATE INDEX IF NOT EXISTS `event_custom_questions_event_active_sort_idx`
  ON `event_custom_questions` (`event_id`, `is_active`, `sort_order`);


CREATE TABLE IF NOT EXISTS `video_custom_answers` (
  `video_id` text NOT NULL,
  `event_id` text NOT NULL,
  `question_id` text NOT NULL,
  `answer_text` text,
  `answer_json` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(`video_id`, `event_id`, `question_id`)
);

CREATE INDEX IF NOT EXISTS `video_custom_answers_video_idx`
  ON `video_custom_answers` (`video_id`);

CREATE INDEX IF NOT EXISTS `video_custom_answers_event_idx`
  ON `video_custom_answers` (`event_id`);

CREATE INDEX IF NOT EXISTS `video_custom_answers_question_idx`
  ON `video_custom_answers` (`question_id`);

CREATE INDEX IF NOT EXISTS `video_custom_answers_video_event_idx`
  ON `video_custom_answers` (`video_id`, `event_id`);
