-- Pending contract: video_moderation_cases open case partial unique index
-- Apply only after check:moderation-open-cases reports zero duplicates.
-- Do NOT place in migrations/ until data is clean.

CREATE UNIQUE INDEX IF NOT EXISTS video_moderation_cases_open_unique_idx
  ON video_moderation_cases (video_id, case_type)
  WHERE status = 'open';
