-- Migration: 0044_simplify_visibility_statuses.sql
-- Date: 2026-07-20
-- Type: cleanup
-- Summary: Simplify FlameNode video and event visibility states after the canonical DB migration
-- Data loss: none
-- Rollback: restore the pre-migration D1 backup because status meaning changes
-- Change log: docs/database/change-log.md

-- このmigrationは0043_db_canonical_migration.sqlの完了後にだけ適用する。
-- 正本移行前の旧構造へ誤適用した場合は、何も更新せず明示的に失敗させる。
CREATE TABLE "_migration_0044_canonical_guard" (
  "ok" integer NOT NULL CHECK ("ok" = 1)
);

INSERT INTO "_migration_0044_canonical_guard" ("ok")
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type = 'table' AND name = 'x_user_account_links'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_info('video_youtube_metadata')
    WHERE name = 'youtube_video_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_info('events')
    WHERE name = 'representative_x_user_id'
  )
  THEN 1
  ELSE 0
END;

DROP TABLE "_migration_0044_canonical_guard";

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

-- archivedをprivateへ移すと既存partial unique indexの対象になる。
-- 同じYouTube IDを持つ有効作品がある場合、またはarchived同士で2件目以降の場合だけ
-- archived側をvoidedへ振り分ける。YouTube ID自体はvideosに保持する。
CREATE TABLE "_migration_0044_archived_duplicates" (
  "video_id" text PRIMARY KEY NOT NULL,
  "youtube_video_id" text NOT NULL
);

INSERT INTO "_migration_0044_archived_duplicates" (
  "video_id",
  "youtube_video_id"
)
SELECT ranked.id, ranked.youtube_video_id
FROM (
  SELECT
    id,
    youtube_video_id,
    visibility_status,
    ROW_NUMBER() OVER (
      PARTITION BY youtube_video_id
      ORDER BY
        CASE
          WHEN visibility_status NOT IN ('archived', 'voided') THEN 0
          WHEN visibility_status = 'archived' THEN 1
          ELSE 2
        END,
        updated_at DESC,
        created_at DESC,
        id ASC
    ) AS duplicate_rank
  FROM videos
  WHERE youtube_video_id IS NOT NULL
    AND youtube_video_id <> ''
) AS ranked
WHERE ranked.visibility_status = 'archived'
  AND ranked.duplicate_rank > 1;

-- 行やYouTube IDは削除せず、振り分け理由を監査可能な案件として残す。
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
  'migration-0044-archived-duplicate-' || video_id,
  video_id,
  'duplicate',
  'resolved',
  '0044 migration kept YouTube ID and moved duplicate archived video to voided: ' || youtube_video_id,
  unixepoch(),
  unixepoch()
FROM "_migration_0044_archived_duplicates";

UPDATE videos
SET visibility_status = 'voided',
    updated_at = unixepoch()
WHERE id IN (
  SELECT video_id FROM "_migration_0044_archived_duplicates"
);

DROP TABLE "_migration_0044_archived_duplicates";

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

-- 正本移行後も物理defaultは旧値を保持するため、default由来のdraftだけを即時正規化する。
-- limited / archived / hiddenの新規書き込みは、YouTube区分や無効化理由を失わないよう拒否する。
DROP TRIGGER IF EXISTS events_visibility_status_canonical_insert;
CREATE TRIGGER events_visibility_status_canonical_insert
AFTER INSERT ON events
FOR EACH ROW
WHEN NEW.visibility_status = 'draft'
BEGIN
  UPDATE events
  SET visibility_status = 'private',
      updated_at = unixepoch()
  WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS events_visibility_status_reject_insert;
CREATE TRIGGER events_visibility_status_reject_insert
BEFORE INSERT ON events
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('draft', 'private', 'public')
BEGIN
  SELECT RAISE(ABORT, 'events.visibility_status must be private or public');
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
WHEN NEW.visibility_status = 'draft'
BEGIN
  UPDATE videos
  SET visibility_status = 'pending',
      updated_at = unixepoch()
  WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS videos_visibility_status_reject_insert;
CREATE TRIGGER videos_visibility_status_reject_insert
BEFORE INSERT ON videos
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('draft', 'pending', 'public', 'private', 'voided')
BEGIN
  SELECT RAISE(ABORT, 'videos.visibility_status must be canonical');
END;

DROP TRIGGER IF EXISTS videos_visibility_status_canonical_update;
CREATE TRIGGER videos_visibility_status_canonical_update
BEFORE UPDATE OF visibility_status ON videos
FOR EACH ROW
WHEN NEW.visibility_status NOT IN ('pending', 'public', 'private', 'voided')
BEGIN
  SELECT RAISE(ABORT, 'videos.visibility_status must be canonical');
END;

-- バックフィル漏れを残したまま完了しない。
CREATE TABLE "_migration_0044_status_guard" (
  "ok" integer NOT NULL CHECK ("ok" = 1)
);

INSERT INTO "_migration_0044_status_guard" ("ok")
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM events
    WHERE visibility_status NOT IN ('private', 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM videos
    WHERE visibility_status NOT IN ('pending', 'public', 'private', 'voided')
  )
  THEN 1
  ELSE 0
END;

DROP TABLE "_migration_0044_status_guard";
