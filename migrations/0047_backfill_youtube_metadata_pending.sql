-- Migration: 0047_backfill_youtube_metadata_pending.sql
-- Date: 2026-08-01
-- Type: data-migration
-- Summary: YouTube ID を持つ既存作品の欠損 metadata 行を pending で補完
-- Data loss: none
-- Rollback: 追加された pending 行のみを適用前バックアップとの差分で削除
-- Change log: docs/database/change-log.md

INSERT OR IGNORE INTO video_youtube_metadata (
  video_id,
  sync_status,
  updated_at
)
SELECT
  v.id,
  'pending',
  unixepoch()
FROM videos AS v
WHERE NULLIF(TRIM(v.youtube_video_id), '') IS NOT NULL
  AND v.visibility_status <> 'voided'
  AND NOT EXISTS (
    SELECT 1
    FROM video_youtube_metadata AS metadata
    WHERE metadata.video_id = v.id
  );
