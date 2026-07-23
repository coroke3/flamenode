/** PVSF まとめイベント。公開作品集計から除外する。 */
export const PVSF_SUMMARY_EVENT_ID = "PVSFSummary";

/** workers/json-generator 等の生 SQL 用。videos エイリアスは `v`。 */
export const COUNTABLE_PUBLIC_VIDEO_SQL = `
  v.visibility_status = 'public'
  AND COALESCE(v.primary_event_id, '') <> '${PVSF_SUMMARY_EVENT_ID}'
  AND NOT EXISTS (
    SELECT 1 FROM video_events AS pvsf_summary_video_events
    WHERE pvsf_summary_video_events.video_id = v.id
      AND pvsf_summary_video_events.event_id = '${PVSF_SUMMARY_EVENT_ID}'
  )
`;
