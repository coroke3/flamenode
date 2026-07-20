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
        },
      ],
      chapters: [
        {
          id: "chapter-1",
          x_user_id: "creator_id",
          chapter_time: 30,
          chapter_label: "見どころ",
          note: "注記",
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
      ],
    },
  ],
  limit: 500,
  truncated: false,
};

test("イベント公開API v4はDB正本の構造だけを返す", () => {
  const payload = buildEventExportPayload(
    snapshot,
    1_700_000_200,
    "scheduled",
  );
  assert.equal(payload.schema_version, 4);
  assert.equal(payload.format, "flamenode-event-export");
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
  assert.deepEqual(Object.keys(video.members[0]).sort(), [
    "name",
    "order",
    "role_label",
    "x_id",
    "x_url",
  ]);
  assert.equal(video.chapters[0].id, "chapter-1");
  assert.equal(video.chapters[0].time_seconds, 30);
  assert.equal(video.chapters[0].author.x_id, "creator_id");
  assert.equal(video.softwares[0].source_label, "AE");
  assert.match(video.source.thumbnails.medium_url, /mqdefault\.jpg$/);
  assert.match(video.source.thumbnails.large_url, /maxresdefault\.jpg$/);
  assert.equal(video.custom_answers_by_key.stage_permission, "可");
  assert.deepEqual(video.creator.other_social_links, {
    portfolio: "https://example.com",
  });
});

test("イベント公開APIに旧形式フィールドと内部情報を含めない", () => {
  const serialized = JSON.stringify(buildEventExportPayload(snapshot));
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
    "chapters_json",
    "show_on_player_bar",
    "order_index",
  ]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false, forbidden);
  }
});

test("イベントAPIはformatパラメータを拒否しv4だけを返す", async () => {
  const route = await readFile(
    new URL("../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /format_parameter_removed/);
  assert.match(route, /schema_version:\s*4/);
  assert.match(route, /X-FlameNode-Schema-Version\", \"4\"/);
  assert.match(route, /buildEventExportPayload/);
  assert.doesNotMatch(route, /buildEventExportPayloadForFormat/);
  assert.doesNotMatch(route, /value === "legacy"|value === "new"/);
  assert.match(route, /eventExportPayloadCacheKey\(\s*eventId,\s*refreshMinutes/);
  assert.match(route, /eventExportAccessCacheKey/);
  assert.match(route, /s-maxage=60/);
});

test("管理画面は形式選択を持たず更新方式だけを選ぶ", async () => {
  const builder = await readFile(
    new URL("../components/admin/EventExportLinkBuilder.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(builder, /option value="new"|option value="legacy"/);
  assert.doesNotMatch(builder, /name="format"|\{ format,/);
  assert.match(builder, /イベントAPI v4に統一/);
  assert.match(builder, /update:\s*updateMode/);
});

test("旧形式ビルダーとディスパッチ型を再導入しない", async () => {
  const payloadSource = await readFile(
    new URL("./api/eventExportPayload.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    payloadSource,
    /buildLegacyEventExportPayload|buildEventExportPayloadForFormat|EventExportFormat/,
  );
  assert.doesNotMatch(payloadSource, /legacyDateParts|memberChapterBounds/);
});
