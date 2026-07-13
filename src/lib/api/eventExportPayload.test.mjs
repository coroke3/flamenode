import test from "node:test";
import assert from "node:assert/strict";
import { buildEventExportPayload } from "./eventExportPayload.ts";

const snapshot = {
  event: {
    id: "event-1",
    title: "テストイベント",
    explanation: "説明",
    icon_url: null,
    img_url: null,
    accent_color: "#b7ff00",
    event_type: "event",
    start_time: 1_700_000_000,
    end_time: 1_700_003_600,
    entry_start_time: null,
    entry_end_time: null,
    updated_at: 1_700_000_100,
  },
  videos: [
    {
      id: "video-1",
      title: "テスト作品",
      primary_event_id: "event-1",
      collaboration_type: "collab",
      part: "1部",
      source_type: "youtube",
      creator_display_name: "制作者",
      creator_display_name_yomi: "せいさくしゃ",
      creator_x_user_id: "creator_id",
      creator_icon_url: "https://example.com/icon.png",
      creator_youtube_channel_url: "https://youtube.com/@creator",
      creator_other_social_links: '{"portfolio":"https://example.com"}',
      music: "楽曲",
      credit: "作曲者",
      music_reference_url: "https://example.com/music",
      intro_comment: "紹介",
      highlights: "見どころ",
      production_story: "制作話",
      closing_comment: "後書き",
      youtube_video_id: "abcdefghijk",
      scheduled_time: 1_700_000_000,
      app_like_count: 5,
      score: 12.5,
      created_at: 1_699_999_000,
      updated_at: 1_700_000_100,
      members: [
        {
          x_user_id: "member_id",
          name: "メンバー",
          role_label: "映像",
          order_index: 0,
          chapters_json: '[{"time_seconds":12,"label":"担当"}]',
        },
      ],
      softwares: [
        { name: "After Effects", raw_label: "AE", order_index: 0 },
      ],
      answers: [
        {
          key: "public_note",
          label: "公開コメント",
          answer_text: "回答",
          answer_json: null,
          sort_order: 0,
        },
      ],
    },
  ],
  limit: 500,
  truncated: false,
};

test("旧形式互換は配列と従来キーを返す", () => {
  const payload = buildEventExportPayload(snapshot, "legacy", 1_700_000_200, "realtime");
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 1);
  assert.equal(payload[0].eventid, "event-1");
  assert.equal(payload[0].title, "テスト作品");
  assert.equal(payload[0].ylink, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(payload[0].memberid, "@member_id");
  assert.equal(payload[0].starts, "12");
  assert.equal(payload[0].soft, "AE");
  assert.match(payload[0].largeThumbnail, /maxresdefault\.jpg$/);
});

test("新形式は構造化データと更新方式を返す", () => {
  const payload = buildEventExportPayload(snapshot, "new", 1_700_000_200, "scheduled");
  assert.equal(payload.schema_version, 2);
  assert.equal(payload.update_mode, "scheduled");
  assert.equal(payload.event.id, "event-1");
  assert.equal(payload.videos[0].creator.x_id, "creator_id");
  assert.equal(payload.videos[0].members[0].role_label, "映像");
  assert.equal(payload.videos[0].custom_answers[0].value, "回答");
  assert.deepEqual(payload.videos[0].creator.other_social_links, {
    portfolio: "https://example.com",
  });
});

test("新形式に内部ID・権限・監査キーを含めない", () => {
  const payload = buildEventExportPayload(snapshot, "new");
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "submitted_by_user_id",
    "creator_x_user_id",
    "user_id",
    "discord_id",
    "permission_preset",
    "internal_note",
    "audit_logs",
  ]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false, forbidden);
  }
});
