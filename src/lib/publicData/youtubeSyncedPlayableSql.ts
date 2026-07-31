/**
 * YouTube API 同期済みで public / unlisted と確認された作品だけ。
 * 懐かし棚など、YouTube 再生可否が未取得・非公開の作品を掲載しない用途向け。
 */
export const YOUTUBE_SYNCED_PLAYABLE_SQL = `EXISTS (
  SELECT 1 FROM video_youtube_metadata AS ym
  WHERE ym.video_id = v.id
    AND ym.sync_status = 'synced'
    AND ym.youtube_privacy_status IN ('public', 'unlisted')
)`;
