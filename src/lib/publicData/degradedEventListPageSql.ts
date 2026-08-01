import { COUNTABLE_PUBLIC_VIDEO_SQL } from "./countablePublicVideoSql.ts";

/** `/list?event=` degraded: JOIN + COUNTABLE 条件・LIMIT/OFFSET のみ（相関サブクエリなし）。 */
export function buildDegradedEventListPageSql(
  sort: "new" | "old" | "score",
): string {
  const order =
    sort === "old"
      ? "v.scheduled_time ASC, v.created_at ASC"
      : sort === "score"
        ? "v.scheduled_time DESC, v.created_at DESC"
        : "v.scheduled_time DESC, v.created_at DESC";
  return `
    SELECT
      v.id,
      v.title,
      v.youtube_video_id,
      COALESCE(NULLIF(TRIM(v.creator_display_name), ''), v.creator_x_user_id) AS display_name,
      v.creator_icon_url AS icon_url,
      v.creator_x_user_id,
      v.primary_event_id,
      pe.title AS primary_event_title,
      v.scheduled_time,
      v.part
    FROM videos AS v
    LEFT JOIN events AS pe ON pe.id = v.primary_event_id
    LEFT JOIN video_events AS ve ON ve.video_id = v.id AND ve.event_id = ?
    WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
      AND (ve.video_id IS NOT NULL OR v.primary_event_id = ?)
    ORDER BY ${order}
    LIMIT ? OFFSET ?`;
}
