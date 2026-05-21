-- メンバーチャプターを通常のチャプターコメント (video_chapters) から分離する。
-- 1) video_member_chapters テーブルを新設
-- 2) 既存 video_chapters のうち video_member_id IS NOT NULL の行を新テーブルへコピー
-- 3) コピー元行は video_chapters から削除 (通常チャプターコメント側に残らないようにする)
--    video_chapters.video_member_id 列自体は互換のため残置 (新仕様では参照しない)

CREATE TABLE IF NOT EXISTS video_member_chapters (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  video_member_id TEXT NOT NULL,
  chapter_time REAL NOT NULL,
  chapter_label TEXT NOT NULL,
  note TEXT,
  order_index INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_member_chapters_video_idx
  ON video_member_chapters (video_id, chapter_time);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS video_member_chapters_member_idx
  ON video_member_chapters (video_member_id, chapter_time);
--> statement-breakpoint

-- 既存データ移行: video_chapters.video_member_id IS NOT NULL の行を新テーブルへ
INSERT INTO video_member_chapters (
  id,
  video_id,
  video_member_id,
  chapter_time,
  chapter_label,
  note,
  order_index,
  created_at,
  updated_at
)
SELECT
  'vmc_' || vc.id,
  vc.video_id,
  vc.video_member_id,
  vc.chapter_time,
  vc.chapter_label,
  vc.note,
  COALESCE(vc.order_index, 0),
  vc.created_at,
  vc.updated_at
FROM video_chapters vc
WHERE vc.video_member_id IS NOT NULL
  -- 想定外の重複コピーを避ける
  AND NOT EXISTS (
    SELECT 1 FROM video_member_chapters vmc
      WHERE vmc.id = 'vmc_' || vc.id
  );
--> statement-breakpoint

-- 元の video_chapters 行は削除 (通常チャプターコメント側に残ったままだと混ざるため)
DELETE FROM video_chapters WHERE video_member_id IS NOT NULL;
