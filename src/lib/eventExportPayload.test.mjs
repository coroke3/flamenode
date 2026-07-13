import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildEventExportPayload } from "./api/eventExportPayload.ts";

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
    public_staff: [
      {
        x_user_id: "operator_id",
        display_name: "運営者",
        public_role_label: "主催",
        x_name: "運営者X",
        icon_url: "https://example.com/operator.png",
      },
    ],
  },
  videos: [
    {
      id: "video-1",
      title: "テスト作品",
      primary_event_id: "event-1",
      event_ids: ["event-1", "related-event"],
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
          chapters_json: '[{"time_seconds":12,"label":"担当","end_seconds":24}]',
        },
      ],
      chapters: [
        {
          x_user_id: "creator_id",
          chapter_time: 30,
          chapter_label: "見どころ",
          note: "注記",
          show_on_player_bar: 1,
          order_index: 0,
        },
      ],
      softwares: [
        { name: "After Effects", raw_label: "AE", order_index: 0 },
      ],
      answers: [
        {
          key: "stage_permission",
          label: "上映可否",
          answer_text: "可",
          answer_json: null,
          sort_order: 0,
        },
        {
          key: "production_experience",
          label: "制作歴",
          answer_text: "3年",
          answer_json: null,
          sort_order: 1,
        },
      ],
    },
  ],
  limit: 500,
  truncated: false,
};

test("統一形式v3は旧形式の意味ある情報を構造化して包含する", () => {
  const payload = buildEventExportPayload(
    snapshot,
    1_700_000_200,
    "scheduled",
  );
  assert.equal(payload.schema_version, 3);
  assert.equal(payload.update_mode, "scheduled");
  assert.equal(payload.event.id, "event-1");
  assert.equal(payload.event.status, "public");
  assert.equal(payload.event.unix_time.start, 1_700_000_000);
  assert.equal(payload.event.public_staff[0].role_label, "主催");

  const video = payload.videos[0];
  assert.deepEqual(video.event_ids, ["event-1", "related-event"]);
  assert.equal(video.participant_scope, "group");
  assert.equal(video.creator.x_id, "creator_id");
  assert.equal(video.members[0].role_label, "映像");
  assert.equal(video.members[0].chapters[0].time_seconds, 12);
  assert.equal(video.members[0].chapters[0].end_seconds, 24);
  assert.equal(video.chapters[0].time_seconds, 30);
  assert.equal(video.softwares[0].source_label, "AE");
  assert.match(video.source.thumbnails.medium_url, /mqdefault\.jpg$/);
  assert.match(video.source.thumbnails.large_url, /maxresdefault\.jpg$/);
  assert.equal(video.custom_answers_by_key.stage_permission, "可");
  assert.equal(video.custom_answers_by_key.production_experience, "3年");
  assert.deepEqual(video.creator.other_social_links, {
    portfolio: "https://example.com",
  });
});

test("統一形式に旧フラットキーと内部情報を含めない", () => {
  const payload = buildEventExportPayload(snapshot);
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "submitted_by_user_id",
    "creator_x_user_id",
    "user_id",
    "discord_id",
    "permission_preset",
    "internal_note",
    "audit_logs",
    "memberid",
    "beforecomment",
    "aftercomment",
    "largeThumbnail",
    "type1",
    "type2",
    "toudan",
    "righttype",
  ]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false, forbidden);
  }
});

test("イベントAPIは旧レスポンス生成を使用せずlegacy指定を廃止扱いにする", async () => {
  const route = await readFile(
    new URL("../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(route, /buildEventApiPayload|EVENT_API_VIDEO_LIMIT/);
  assert.doesNotMatch(route, /buildLegacyRows/);
  assert.match(route, /legacy_format_removed/);
  assert.match(route, /schema_version:\s*3/);
});
