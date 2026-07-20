-- Migration: 0043_simplify_visibility_statuses.sql
-- Date: 2026-07-20
-- Type: cleanup
-- Summary: Simplify FlameNode video and event visibility states and separate YouTube unlisted metadata
-- Data loss: none
-- Rollback: restore the pre-migration D1 backup because status meaning and the YouTube ID unique index change
-- Change log: docs/database/change-log.md

-- limitedだった作品はYouTube上の限定公開として記録する。
-- API同期済みの明示値は上書きしない。
UPDATE video_youtube_metadata
SET youtube_privacy_status = 'unlisted',
    updated_at = unixepoch()
WHERE video_id IN (
  SELECT id FROM videos WHERE visibility_status = 'limited'
)
  AND (
    youtube_privacy_status IS NULL
    OR youtube_privacy_status = ''
    OR youtube_privacy_status = 'unknown'
  );

-- 旧partial unique indexではarchived / voided同士の重複が存在し得る。
-- 公開に近い状態・更新日時が新しい行を代表として残し、それ以外はYouTube IDを解除する。
CREATE TABLE "_migration_0043_duplicate_youtube_ids" (
  "video_id" text PRIMARY KEY NOT NULL,
  "youtube_video_id" text NOT NULL
);

INSERT INTO "_migration_0043_duplicate_youtube_ids" (
  "video_id",
  "youtube_video_id"
)
SELECT ranked.id, ranked.youtube_video_id
FROM (
  SELECT
    id,
    youtube_video_id,
    ROW_NUMBER() OVER (
      PARTITION BY youtube_video_id
      ORDER BY
        CASE visibility_status
          WHEN 'public' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'private' THEN 2
          WHEN 'limited' THEN 3
          WHEN 'draft' THEN 4
          WHEN 'hidden' THEN 5
          WHEN 'archived' THEN 6
          WHEN 'voided' THEN 7
          ELSE 8
        END,
        updated_at DESC,
        created_at DESC,
        id ASC
    ) AS duplicate_rank
  FROM videos
  WHERE youtube_video_id IS NOT NULL
    AND youtube_video_id <> ''
) AS ranked
WHERE ranked.duplicate_rank > 1;

-- 削除はせず、重複解消の理由と元のYouTube IDをモデレーション履歴に残す。
INSERT OR IGNORE INTO video_moderation_cases (
  id,
  video_id,
  case_type,
  status,
  private_note,
  created_at,
  resolved_at
)
SELECT
  'migration-0043-duplicate-' || video_id,
  video_id,
  'duplicate',
  'resolved',
  '0043 migration cleared duplicate YouTube ID: ' || youtube_video_id,
  unixepoch(),
  unixepoch()
FROM "_migration_0043_duplicate_youtube_ids";

UPDATE video_youtube_metadata
SET youtube_video_id = NULL,
    updated_at = unixepoch()
WHERE video_id IN (
  SELECT video_id FROM "_migration_0043_duplicate_youtube_ids"
);

UPDATE videos
SET youtube_video_id = NULL,
    visibility_status = 'voided',
    updated_at = unixepoch()
WHERE id IN (
  SELECT video_id FROM "_migration_0043_duplicate_youtube_ids"
);

DROP TABLE "_migration_0043_duplicate_youtube_ids";

UPDATE videos
SET visibility_status = 'private',
    updated_at = unixepoch()
WHERE visibility_status IN ('draft', 'archived', 'hidden');

UPDATE videos
SET visibility_status = 'public',
    updated_at = unixepoch()
WHERE visibility_status = 'limited';

UPDATE events
SET visibility_status = 'private',
    updated_at = unixepoch()
WHERE visibility_status = 'draft';

UPDATE events
SET visibility_status = 'public',
    updated_at = unixepoch()
WHERE visibility_status = 'archived';

-- 状態に関係なく、同じYouTube動画はDB内に1作品だけ保持する。
DROP INDEX IF EXISTS videos_youtube_id_active_uniq;
CREATE UNIQUE INDEX videos_youtube_id_active_uniq
ON videos (youtube_video_id)
WHERE youtube_video_id IS NOT NULL
  AND youtube_video_id <> '';

-- 0000 baselineは適用済み環境との整合性を守るため変更しない。
-- baselineに残る旧defaultはINSERT直後にcanonical値へ正規化し、
-- UPDATE経路では旧状態の再流入を拒否する。
DROP TRIGGER IF EXISTS events_visibility_status_canonical_insert;
CREATE TRIGGER events_visibility_status_canonical_insert
AFTER INSERT ON events
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('private', 'public')
BEGIN
  UPDATE events
  SET visibility_status = CASE
        WHEN NEW.visibility_status = 'archived' THEN 'public'
        ELSE 'private'
      END,
      updated_at = unixepoch()
  WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS events_visibility_status_canonical_update;
CREATE TRIGGER events_visibility_status_canonical_update
BEFORE UPDATE OF visibility_status ON events
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('private', 'public')
BEGIN
  SELECT RAISE(ABORT, 'events.visibility_status must be private or public');
END;

DROP TRIGGER IF EXISTS videos_visibility_status_canonical_insert;
CREATE TRIGGER videos_visibility_status_canonical_insert
AFTER INSERT ON videos
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('pending', 'public', 'private', 'voided')
BEGIN
  UPDATE videos
  SET visibility_status = CASE
        WHEN NEW.visibility_status = 'limited' THEN 'public'
        WHEN NEW.visibility_status = 'draft' THEN 'pending'
        ELSE 'private'
      END,
      updated_at = unixepoch()
  WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS videos_visibility_status_canonical_update;
CREATE TRIGGER videos_visibility_status_canonical_update
BEFORE UPDATE OF visibility_status ON videos
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('pending', 'public', 'private', 'voided')
BEGIN
  SELECT RAISE(ABORT, 'videos.visibility_status must be canonical');
END;
