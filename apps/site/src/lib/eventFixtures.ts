/**
 * Build-time event payloads in CURRENT's R2 JSON shape (`events/index.json`, `events/{id}.json`,
 * `events/{id}/release.v1.json`), used only when no snapshot directory is configured (MIG-0502).
 * They go through the same CURRENT normalizers as a real snapshot, so private/unknown rows are dropped
 * the same way. Times are fixed far from now (entry window open until 2100) so built output does not
 * depend on the build date.
 */
const T2020 = 1_580_000_000;
const T2023 = 1_700_000_000;
const T2100 = 4_102_444_800;

const OPEN_EVENT = {
  id: "autumn-collab-2026",
  title: "FlameNode Autumn Festival 2026",
  explanation: "秋の音楽・動画クリエイター合同コラボレーションイベント。\n1枠5分で連続上映します。",
  public_operator_names: ["新概念", "スティックのり"],
  icon_url: "https://flamenode.net/brand/icon.png",
  img_url: "https://flamenode.net/brand/banner.png",
  accent_color: "#c8f21f",
  event_type: "event",
  slot_type: "time",
  slot_visibility_mode: "public_name",
  max_slots_per_video: 2,
  start_time: T2100 + 100_000,
  end_time: T2100 + 186_400,
  entry_start_time: T2023,
  entry_end_time: T2100,
  visibility_status: "public",
};
const ENDED_EVENT = {
  id: "past-event-2020",
  title: "年越し合作 2020",
  explanation: "終了済みイベントの例です。",
  public_operator_names: ["lalaClione"],
  icon_url: null,
  img_url: null,
  accent_color: null,
  event_type: "collabo",
  slot_type: "count",
  slot_visibility_mode: "anonymous",
  max_slots_per_video: 1,
  start_time: T2020,
  end_time: T2020 + 86_400,
  entry_start_time: null,
  entry_end_time: null,
  visibility_status: "public",
};
const SCHEDULED_EVENT = {
  id: "no-slot-event-2100",
  title: "枠なしイベント",
  explanation: null,
  public_operator_names: [],
  icon_url: null,
  img_url: null,
  accent_color: null,
  event_type: "other",
  slot_type: null,
  slot_visibility_mode: null,
  max_slots_per_video: 1,
  start_time: T2100,
  end_time: T2100 + 86_400,
  entry_start_time: null,
  entry_end_time: null,
  visibility_status: "public",
};
const PRIVATE_EVENT = { ...OPEN_EVENT, id: "draft-secret-event", title: "下書きイベント（SSG生成禁止）", visibility_status: "private" };

export const FIXTURE_EVENTS_INDEX_PAYLOAD = {
  generated_at: T2023,
  items: [OPEN_EVENT, ENDED_EVENT, SCHEDULED_EVENT, PRIVATE_EVENT],
  group_sections: [
    {
      id: "grp-1",
      slug: "autumn",
      name: "合作",
      description: "合作イベントのまとめ",
      group_type: "genre",
      icon_url: null,
      accent_color: "#c8f21f",
      sort_order: 1,
      latest_event_start_time: OPEN_EVENT.start_time,
      events: [OPEN_EVENT, ENDED_EVENT, PRIVATE_EVENT],
    },
  ],
};

const slot = (id: string, status: string, start: number | null, order: number) => ({ id, status, start_time: start, sort_order: order });
const T_SLOT = T2100 + 100_000;

export const FIXTURE_EVENT_DETAIL_PAYLOADS: Record<string, unknown> = {
  "autumn-collab-2026": {
    generated_at: T2023,
    event: { ...OPEN_EVENT, slot_part_gap_minutes: 15, parts: ["第1部", "第2部"], youtube_playlist_id: "PLabcdefghijklmnop" },
    public_staff: [
      { role: "owner", display_name: "新概念", public_role_label: "代表", x_user_id: "shingainen", x_name: "新概念", icon_url: null, has_public_profile: true },
      { role: "staff", display_name: "スティックのり", public_role_label: null, x_user_id: null, x_name: null, icon_url: null, has_public_profile: false },
    ],
    slots_summary: [{ status: "available", c: 3 }, { status: "reserved", c: 1 }],
    slots: [
      slot("s1", "reserved", T_SLOT, 0),
      slot("s2", "available", T_SLOT + 360, 1),
      slot("s3", "available", T_SLOT + 360 * 20, 2),
      slot("s4", "available", T_SLOT + 360 * 21, 3),
    ],
    public_videos: [
      { id: "vid-aaa", title: "【文字PV】スチールワンダー", creator_display_name: "スティックのり", creator_x_user_id: null, youtube_video_id: "dKw1xV41f8s", scheduled_time: T_SLOT, visibility_status: "public" },
      { id: "vid-bbb", title: "模範囚", creator_display_name: "hato", creator_x_user_id: "hato", youtube_video_id: null, scheduled_time: T_SLOT + 360, visibility_status: "public" },
      { id: "vid-private", title: "非公開の作品", creator_display_name: "x", visibility_status: "private" },
    ],
    video_total: 12,
    creator_count: 9,
  },
  "past-event-2020": {
    generated_at: T2023,
    event: ENDED_EVENT,
    public_staff: [],
    slots_summary: [{ status: "submitted", c: 2 }],
    slots: [slot("p1", "submitted", null, 0), slot("p2", "submitted", null, 1)],
    public_videos: [],
    video_total: 0,
    creator_count: 0,
  },
  "no-slot-event-2100": {
    generated_at: T2023,
    event: SCHEDULED_EVENT,
    public_staff: [],
    slots_summary: [],
    slots: [],
    public_videos: [],
    video_total: 0,
    creator_count: 0,
  },
  "draft-secret-event": {
    generated_at: T2023,
    event: PRIVATE_EVENT,
    public_staff: [],
    slots: [],
    public_videos: [],
  },
};

export const FIXTURE_EVENT_RELEASE_PAYLOADS: Record<string, unknown> = {
  "autumn-collab-2026": {
    schema_version: 1,
    generated_at: T2023,
    event: { id: "autumn-collab-2026", title: OPEN_EVENT.title, accent_color: "#c8f21f", visibility_status: "public" },
    videos: [
      {
        id: "vid-aaa", title: "【文字PV】スチールワンダー", youtube_video_id: "dKw1xV41f8s", scheduled_time: T_SLOT, collaboration_type: "individual",
        part: "第1部", intro_comment: "ひとことコメントです。", creator_display_name: "スティックのり", creator_x_user_id: "stick_nori", creator_icon_url: null,
        visibility_status: "public", members: [],
      },
      {
        id: "vid-bbb", title: "模範囚", youtube_video_id: null, scheduled_time: T_SLOT + 360, collaboration_type: "collab",
        part: "第1部", intro_comment: null, creator_display_name: "合作チーム", creator_x_user_id: null, creator_icon_url: null,
        visibility_status: "public",
        members: [
          { name: "hato", x_user_id: "hato", role: "動画", comment: null, order_index: 0 },
          { name: "あいこ", x_user_id: null, role: null, comment: "音", order_index: 1 },
        ],
      },
      { id: "vid-private", title: "非公開", scheduled_time: T_SLOT + 720, visibility_status: "private", creator_display_name: "x" },
    ],
    total: 3,
    truncated: false,
  },
  "past-event-2020": {
    schema_version: 1,
    generated_at: T2023,
    event: { id: "past-event-2020", title: ENDED_EVENT.title, accent_color: null, visibility_status: "public" },
    videos: [],
    total: 0,
    truncated: false,
  },
};
