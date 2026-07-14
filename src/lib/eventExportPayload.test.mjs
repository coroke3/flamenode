import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildEventExportPayload,
  buildEventExportPayloadForFormat,
  buildLegacyEventExportPayload,
} from "./api/eventExportPayload.ts";

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
          key: "stage_participation",
          label: "登壇可否",
          answer_text: "参加",
          answer_json: null,
          sort_order: 1,
        },
        {
          key: "production_experience",
          label: "制作歴",
          answer_text: "3年",
          answer_json: null,
          sort_order: 2,
        },
      ],
    },
  ],
  limit: 500,
  truncated: false,
};

test("新形式v3は旧形式の意味ある情報を構造化して包含する", () => {
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
  assert.equal(video.custom_answers_by_key.stage_participation, "参加");
  assert.equal(video.custom_answers_by_key.production_experience, "3年");
  assert.deepEqual(video.creator.other_social_links, {
    portfolio: "https://example.com",
  });
});

test("旧形式互換は正規化済みデータから旧列を復元する", () => {
  const payload = buildLegacyEventExportPayload(snapshot);
  assert.equal(payload.length, 1);
  const row = payload[0];
  assert.equal(row.eventid, "event-1");
  assert.equal(row.type1, "複数人");
  assert.equal(row.type2, "団体");
  assert.equal(row.creator, "制作者");
  assert.equal(row.member, "メンバー");
  assert.equal(row.memberid, "@member_id");
  assert.equal(row.starts, "12");
  assert.equal(row.ends, "24");
  assert.equal(row.righttype, "可");
  assert.equal(row.toudan, "参加");
  assert.equal(row.movieyear, "3年");
  assert.equal(row.soft, "AE");
  assert.equal(row.beforecomment, "紹介");
  assert.equal(row.aftercomment, "後書き");
  assert.match(row.small, /mqdefault\.jpg$/);
  assert.match(row.largeThumbnail, /maxresdefault\.jpg$/);
});

test("形式ディスパッチは新旧の応答形を切り替える", () => {
  const legacy = buildEventExportPayloadForFormat(snapshot, "legacy");
  const modern = buildEventExportPayloadForFormat(
    snapshot,
    "new",
    1_700_000_200,
    "realtime",
  );
  assert.equal(Array.isArray(legacy), true);
  assert.equal(modern.schema_version, 3);
});

test("新形式に旧フラットキーと内部情報を含めない", () => {
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

test("イベントAPIは新旧形式と形式別KVキャッシュを提供する", async () => {
  const route = await readFile(
    new URL("../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(route, /legacy_format_removed/);
  assert.match(route, /value === "legacy"/);
  assert.match(route, /allowed:\s*\["new", "legacy"\]/);
  assert.match(route, /buildEventExportPayloadForFormat/);
  assert.match(route, /eventExportPayloadCacheKey\(\s*eventId,\s*format,/);
  assert.match(route, /eventExportAccessCacheKey/);
  assert.match(route, /X-FlameNode-Format/);
  assert.match(route, /s-maxage=60/);
  assert.match(route, /publicJsonBodyResponse/);
  assert.match(route, /kv\.put\(payloadCacheKey, body/);
  assert.doesNotMatch(route, /kv\.put\(payloadCacheKey, JSON\.stringify/);
});

test("管理画面と有効化処理が形式選択と即時キャッシュ破棄に対応する", async () => {
  const [builder, action] = await Promise.all([
    readFile(
      new URL("../components/admin/EventExportLinkBuilder.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("./actions/api-endpoints.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(builder, /option value="new"/);
  assert.match(builder, /option value="legacy"/);
  assert.match(builder, /new URLSearchParams\(\{ format, update: updateMode \}\)/);
  assert.match(action, /invalidateEventExportCache\(eventId\)/);
});
