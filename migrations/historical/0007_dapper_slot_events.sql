-- 1) slot 経由で submit された video のうち video_events に行が欠けているものを補修。
--    新規 submit は src/lib/actions/video.ts:submitSlotVideo で同時に video_events を挿入するが、
--    既存データには primary_event_id だけ入っていて video_events が空、というケースが残り得る。
--    INSERT OR IGNORE は既存 (video_id, event_id) があれば no-op。
INSERT OR IGNORE INTO video_events (video_id, event_id)
SELECT id, primary_event_id
FROM videos
WHERE primary_event_id IS NOT NULL
  AND is_deleted = 0;
--> statement-breakpoint

-- 2) YouTube 動画 ID の同時投稿レース対策の partial unique index。
--    src/lib/actions/video.ts の createFreeVideo / submitSlotVideo / updateVideo は
--    SELECT で重複確認してから insert/update しているが、その間に他クライアントが
--    同じ youtube_video_id を投稿すると両方通過し得る。
--    voided / 削除済みは別作品扱いなので除外する partial unique にする。
CREATE UNIQUE INDEX IF NOT EXISTS videos_youtube_id_active_uniq
ON videos (youtube_video_id)
WHERE youtube_video_id IS NOT NULL
  AND youtube_video_id <> ''
  AND is_deleted = 0
  AND status <> 'voided';
