-- Migration: 0052_video_interactions_auth_expand.sql
-- Date: 2026-08-02
-- Type: additive
-- Summary: Auth user 単位のいいね・セーブ正本テーブルを追加し、owner が 1 人の既存行だけをバックフィル
-- Data loss: none (旧 video_interactions は維持)
-- Rollback: migration 適用前の D1 バックアップから復元
-- Change log: docs/database/change-log.md

CREATE TABLE video_interactions_auth (
  auth_user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('like', 'bookmark')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (auth_user_id, video_id, interaction_type),
  FOREIGN KEY (auth_user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX video_interactions_auth_video_type_idx
  ON video_interactions_auth (video_id, interaction_type, created_at);

CREATE TABLE _migration_0052_backfill_report (
  x_user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  owner_count INTEGER NOT NULL,
  PRIMARY KEY (x_user_id, video_id, interaction_type)
);

-- owner がちょうど 1 人の x_user_id だけ既存 interaction を auth 正本へ移す。
INSERT OR IGNORE INTO video_interactions_auth (
  auth_user_id, video_id, interaction_type, created_at
)
SELECT
  sole_owner.auth_user_id,
  vi.video_id,
  vi.interaction_type,
  vi.created_at
FROM video_interactions AS vi
INNER JOIN (
  SELECT
    x_user_id,
    MIN(auth_user_id) AS auth_user_id
  FROM x_user_account_links
  WHERE link_role = 'owner'
  GROUP BY x_user_id
  HAVING COUNT(*) = 1
) AS sole_owner
  ON sole_owner.x_user_id = vi.x_user_id;

-- owner 0 人・複数 owner は report へ残す (手動確認用)。
INSERT OR IGNORE INTO _migration_0052_backfill_report (
  x_user_id, video_id, interaction_type, reason, owner_count
)
SELECT
  vi.x_user_id,
  vi.video_id,
  vi.interaction_type,
  CASE
    WHEN COALESCE(owner_stats.owner_count, 0) = 0 THEN 'no_owner'
    ELSE 'ambiguous_owner'
  END,
  COALESCE(owner_stats.owner_count, 0)
FROM video_interactions AS vi
LEFT JOIN (
  SELECT
    x_user_id,
    COUNT(*) AS owner_count
  FROM x_user_account_links
  WHERE link_role = 'owner'
  GROUP BY x_user_id
) AS owner_stats
  ON owner_stats.x_user_id = vi.x_user_id
WHERE COALESCE(owner_stats.owner_count, 0) <> 1;

-- schema 正本に含めない一時 report。適用直後の手動確認用に残さず破棄する。
DROP TABLE IF EXISTS _migration_0052_backfill_report;
