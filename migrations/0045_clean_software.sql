-- 0045: 本格運用前の破壊的整理 — used_software_json を廃止し video_softwares を正本に戻す。
-- 後方互換なし。0044 適用済み DB 向け。

CREATE TABLE IF NOT EXISTS video_softwares (
  video_id TEXT NOT NULL,
  software_id TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, software_id)
);

CREATE INDEX IF NOT EXISTS video_softwares_software_video_idx
  ON video_softwares (software_id, video_id);
CREATE INDEX IF NOT EXISTS video_softwares_video_order_idx
  ON video_softwares (video_id, order_index);

-- software_catalog に無いラベルを追加
INSERT OR IGNORE INTO software_catalog (id, name, normalized_name, created_at, updated_at)
SELECT
  'sw_mig_' || substr(hex(randomblob(8)), 1, 16),
  trim(je.value),
  lower(trim(je.value)),
  unixepoch(),
  unixepoch()
FROM videos v
JOIN json_each(
  CASE
    WHEN json_valid(v.used_software_json) = 1
      AND json_type(json_extract(v.used_software_json, '$.items')) = 'array'
    THEN json_extract(v.used_software_json, '$.items')
    ELSE '[]'
  END
) je
WHERE v.used_software_json IS NOT NULL
  AND trim(v.used_software_json) <> ''
  AND trim(CAST(je.value AS TEXT)) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM software_catalog sc
    WHERE sc.normalized_name = lower(trim(CAST(je.value AS TEXT)))
  );

INSERT OR IGNORE INTO video_softwares (video_id, software_id, raw_label, order_index)
SELECT
  v.id,
  sc.id,
  trim(CAST(je.value AS TEXT)),
  COALESCE(CAST(je.key AS INTEGER), 0)
FROM videos v
JOIN json_each(
  CASE
    WHEN json_valid(v.used_software_json) = 1
      AND json_type(json_extract(v.used_software_json, '$.items')) = 'array'
    THEN json_extract(v.used_software_json, '$.items')
    ELSE '[]'
  END
) je
INNER JOIN software_catalog sc
  ON sc.normalized_name = lower(trim(CAST(je.value AS TEXT)))
WHERE v.used_software_json IS NOT NULL
  AND trim(v.used_software_json) <> ''
  AND trim(CAST(je.value AS TEXT)) <> '';

CREATE TABLE videos_new (
  id TEXT PRIMARY KEY NOT NULL,
  primary_event_id TEXT,
  creator_x_user_id TEXT,
  submitted_by_discord_user_id TEXT NOT NULL,
  collaboration_type TEXT NOT NULL DEFAULT 'individual',
  part TEXT,
  source_type TEXT NOT NULL DEFAULT 'youtube',
  creator_display_name TEXT NOT NULL,
  creator_display_name_yomi TEXT,
  creator_icon_url TEXT,
  creator_youtube_channel_url TEXT,
  title TEXT NOT NULL,
  music TEXT,
  credit TEXT,
  music_reference_url TEXT,
  closing_comment TEXT,
  youtube_video_id TEXT,
  intro_comment TEXT,
  highlights TEXT,
  production_story TEXT,
  visibility_status TEXT NOT NULL DEFAULT 'draft',
  scheduling_type TEXT DEFAULT 'slotted',
  scheduled_time INTEGER,
  app_like_count INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  trending_view_count_24h INTEGER NOT NULL DEFAULT 0,
  score_updated_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO videos_new SELECT
  id, primary_event_id, creator_x_user_id, submitted_by_discord_user_id,
  collaboration_type, part, source_type, creator_display_name, creator_display_name_yomi,
  creator_icon_url, creator_youtube_channel_url, title, music, credit, music_reference_url,
  closing_comment, youtube_video_id, intro_comment, highlights, production_story,
  visibility_status, scheduling_type, scheduled_time,
  app_like_count, score, trending_view_count_24h, score_updated_at, created_at, updated_at
FROM videos;

DROP TABLE videos;
ALTER TABLE videos_new RENAME TO videos;

CREATE INDEX IF NOT EXISTS videos_visibility_status_idx ON videos (visibility_status);
CREATE INDEX IF NOT EXISTS videos_scheduled_idx ON videos (scheduled_time);
CREATE INDEX IF NOT EXISTS videos_primary_event_idx ON videos (primary_event_id);
CREATE INDEX IF NOT EXISTS videos_submitted_by_idx ON videos (submitted_by_discord_user_id);
CREATE INDEX IF NOT EXISTS videos_creator_x_idx ON videos (creator_x_user_id);
CREATE INDEX IF NOT EXISTS videos_youtube_id_idx ON videos (youtube_video_id);
CREATE UNIQUE INDEX IF NOT EXISTS videos_youtube_id_active_uniq ON videos (youtube_video_id)
  WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> ''
    AND visibility_status NOT IN ('archived', 'voided');
