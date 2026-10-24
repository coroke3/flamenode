/**
 * Build-time video payloads in CURRENT's R2 JSON shape (`videos/{id}.json`), used only when no snapshot
 * directory is configured (MIG-0507), like the event and user fixtures. They go through the same CURRENT
 * normalizers as a real `video-detail` snapshot. The two videos are the ones the event fixture lists
 * (`vid-aaa` with a YouTube id: pages at the YouTube id and at the internal id; `vid-bbb` without: internal id only).
 * Times are fixed so built output does not depend on the build date.
 */
const T_PUBLISHED = 1_760_000_000;

const PUBLIC_EVENT = {
  id: "autumn-collab-2026",
  title: "FlameNode Autumn Festival 2026",
  visibility_status: "public",
  start_time: 4_102_544_800,
  end_time: 4_102_631_200,
};

function payload(video: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: T_PUBLISHED,
    video: { visibility_status: "public", scheduled_time: T_PUBLISHED, primary_event_id: PUBLIC_EVENT.id, creator_has_public_profile: false, creator_icon_url: null, ...video },
    event_ids: [PUBLIC_EVENT.id],
    public_events: [PUBLIC_EVENT],
    public_members: [],
    member_chapters: [],
    public_chapters: [],
    software_labels: [],
    app_like_count: 0,
    related_videos: [],
  };
}

export const FIXTURE_VIDEO_DETAIL_PAYLOADS: Readonly<Record<string, Record<string, unknown>>> = {
  "vid-aaa": payload({
    id: "vid-aaa", title: "【文字PV】スチールワンダー", youtube_video_id: "dKw1xV41f8s", creator_display_name: "スティックのり",
    creator_x_user_id: null, intro_comment: "ひとことコメントです。", music: "スチールワンダー", credit: "スティックのり",
  }),
  "vid-bbb": payload({
    id: "vid-bbb", title: "模範囚", youtube_video_id: null, creator_display_name: "hato", creator_x_user_id: "hato",
    creator_has_public_profile: true, intro_comment: "YouTube ID のない作品です。",
  }),
};
