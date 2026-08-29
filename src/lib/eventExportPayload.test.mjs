import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildEventExportPayload,
  buildEventExportPayloadForFormat,
  buildLegacyEventExportPayload,
} from "./api/eventExportPayload.ts";
import { findForbiddenPublicKeys } from "./api/publicDto.ts";

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
      creator_profile_text: "自己紹介テキスト",
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
        {
          id: "chapter-2",
          x_user_id: "member_id",
          chapter_time: 45,
          chapter_label: "担当開始",
          note: null,
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
          key: "director_note",
          label: "制作者コメント",
          answer_text: "公開用コメント",
          answer_json: null,
          sort_order: 1,
        },
        {
          key: "audience_tags",
          label: "対象タグ",
          answer_text: null,
          answer_json: JSON.stringify(["MV", "AI"]),
          sort_order: 2,
        },
      ],
    },
  ],
  limit: 500,
  truncated: false,
};

test("イベント公開API v5はDB正本の構造を維持する", () => {
  const payload = buildEventExportPayload(
    snapshot,
    1_700_000_200,
    "scheduled",
  );
  assert.equal(payload.schema_version, 5);
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
  assert.equal(video.creator.profile_text, "自己紹介テキスト");
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
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      video.custom_answers_by_key,
      "stage_permission",
    ),
    false,
  );
  assert.deepEqual(video.custom_answers, [
    { key: "stage_permission", label: "上映可否", value: "可", order: 0 },
    { key: "director_note", label: "制作者コメント", value: "公開用コメント", order: 1 },
    { key: "audience_tags", label: "対象タグ", value: ["MV", "AI"], order: 2 },
  ]);
  assert.deepEqual(video.custom_answers_by_key, {
    director_note: "公開用コメント",
    audience_tags: ["MV", "AI"],
  });
  assert.deepEqual(video.creator.other_social_links, {
    portfolio: "https://example.com",
  });
});

test("v5 payloadには旧形式フィールドと内部情報を混ぜない", () => {
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

test("旧形式互換はcanonical snapshotから旧EventArchives列を再構成する", () => {
  const payload = buildLegacyEventExportPayload(snapshot);
  assert.equal(Array.isArray(payload), true);
  assert.equal(payload.length, 1);
  const video = payload[0];
  assert.equal(video.id, "video-1");
  assert.equal(video.eventid, "event-1");
  assert.equal(video.type1, "複数人");
  assert.equal(video.type2, "団体");
  assert.equal(video.creator, "制作者");
  assert.equal(video.member, "メンバー");
  assert.equal(video.memberid, "@member_id");
  assert.equal(video.beforecomment, "紹介");
  assert.equal(video.aftercomment, "後書き");
  assert.equal(video.soft, "AE");
  assert.equal(video.righttype, "可");
  assert.equal(video.director_note, "公開用コメント");
  assert.deepEqual(video.audience_tags, ["MV", "AI"]);
  assert.deepEqual(video.custom_answers, [
    { key: "stage_permission", label: "上映可否", value: "可", order: 0 },
    { key: "director_note", label: "制作者コメント", value: "公開用コメント", order: 1 },
    { key: "audience_tags", label: "対象タグ", value: ["MV", "AI"], order: 2 },
  ]);
  assert.deepEqual(video.custom_answers_by_key, {
    director_note: "公開用コメント",
    audience_tags: ["MV", "AI"],
  });
  assert.equal(video.starts, "45");
  assert.equal(video.ends, "");
  assert.equal(video.startm, "");
  assert.equal(video.endm, "");
  assert.match(String(video.ylink), /youtube\.com\/watch\?v=abcdefghijk/);
  assert.match(String(video.largeThumbnail), /maxresdefault\.jpg$/);
  assert.deepEqual(findForbiddenPublicKeys(payload), []);
});

test("旧形式のカスタム回答は互換列を上書きせずprototypeキーも追加しない", () => {
  const payload = buildLegacyEventExportPayload({
    ...snapshot,
    videos: [
      {
        ...snapshot.videos[0],
        answers: [
          {
            key: "title",
            label: "表示名を狙う質問",
            answer_text: "互換列を上書きしてはいけない",
            answer_json: null,
            sort_order: 0,
          },
          {
            key: "__proto__",
            label: "prototypeキー",
            answer_text: "追加しない",
            answer_json: null,
            sort_order: 1,
          },
        ],
      },
    ],
  });
  const row = payload[0];
  assert.equal(row.title, "テスト作品");
  assert.equal(row.custom_answers_by_key.title, "互換列を上書きしてはいけない");
  assert.equal(Object.prototype.hasOwnProperty.call(row, "__proto__"), false);
  assert.deepEqual(findForbiddenPublicKeys(payload), []);
});

test("形式dispatcherはv5を既定契約のまま保ちlegacyだけ配列へ変換する", () => {
  const v5 = buildEventExportPayloadForFormat(
    snapshot,
    "v5",
    1_700_000_200,
    "realtime",
  );
  const legacy = buildEventExportPayloadForFormat(
    snapshot,
    "legacy",
    1_700_000_200,
    "realtime",
  );
  assert.equal(v5.schema_version, 5);
  assert.equal(Array.isArray(legacy), true);
});

test("イベント公開APIは任意のanswer_jsonオブジェクトとSNS内部キーを公開しない", () => {
  const unsafeSnapshot = {
    ...snapshot,
    event: { ...snapshot.event },
    videos: [
      {
        ...snapshot.videos[0],
        creator_other_social_links: JSON.stringify({
          portfolio: "https://example.com",
          user_id: "secret-user",
          nested: { access_token: "secret-token", label: "公開ラベル" },
        }),
        answers: [
          {
            key: "user_id",
            label: "選択",
            answer_text: null,
            answer_json: JSON.stringify({ user_id: "secret-answer" }),
            sort_order: 0,
          },
        ],
      },
    ],
  };

  const payload = buildEventExportPayload(unsafeSnapshot);
  const video = payload.videos[0];
  assert.deepEqual(video.creator.other_social_links, {
    portfolio: "https://example.com",
    nested: { label: "公開ラベル" },
  });
  assert.equal(video.custom_answers[0].value, null);
  assert.equal(video.custom_answers[0].key, "user_id");
  assert.equal(Object.prototype.hasOwnProperty.call(video.custom_answers_by_key, "user_id"), false);
  assert.deepEqual(findForbiddenPublicKeys(payload), []);

  const legacy = buildLegacyEventExportPayload(unsafeSnapshot);
  const serializedLegacy = JSON.stringify(legacy);
  assert.equal(serializedLegacy.includes("secret-user"), false);
  assert.equal(serializedLegacy.includes("secret-token"), false);
  assert.deepEqual(findForbiddenPublicKeys(legacy), []);
});

test("イベントAPIはformatなし/v5をv5、legacyを旧形式として受け付ける", async () => {
  const route = await readFile(
    new URL("../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /function parseFormat/);
  assert.match(route, /value === "v5"/);
  assert.match(route, /value === "legacy"/);
  assert.match(route, /error: "invalid_format"/);
  assert.match(route, /allowed: \["v5", "legacy"\]/);
  assert.doesNotMatch(route, /format_parameter_removed/);
  assert.match(route, /buildEventExportPayloadForFormat/);
  assert.match(
    route,
    /eventExportPayloadCacheKey\(\s*eventId,\s*format,\s*refreshMinutes/,
  );
  assert.match(route, /X-FlameNode-Schema-Version/);
  assert.match(route, /format === "legacy" \? "1" : "5"/);
  assert.match(route, /format === "legacy" \? "legacy" : "flamenode-event-export"/);
  assert.match(route, /s-maxage=60/);

  const authCheck = route.indexOf("loadEventExportEvent(db, eventId)");
  const cacheHitCheck = route.indexOf("const response = await cachedResponse()");
  assert.ok(authCheck >= 0 && cacheHitCheck > authCheck, "D1公開可否確認をKV HITより先に行う");
});

test("管理画面はv5を既定にし旧形式互換を明示選択できる", async () => {
  const builder = await readFile(
    new URL("../components/admin/EventExportLinkBuilder.tsx", import.meta.url),
    "utf8",
  );
  assert.match(builder, /useState<EventExportFormat>\("v5"\)/);
  assert.match(builder, /option value="v5">新形式 v5/);
  assert.match(builder, /option value="legacy">旧形式互換/);
  assert.match(builder, /format === "legacy"/);
  assert.match(builder, /params\.set\("format", "legacy"\)/);
});

test("scheduled KV cacheはv5とlegacyで衝突せず無効化時に両方消す", async () => {
  const cacheSource = await readFile(
    new URL("./api/eventExportCache.ts", import.meta.url),
    "utf8",
  );
  assert.match(cacheSource, /EventExportCacheFormat = "v5" \| "legacy"/);
  assert.match(
    cacheSource,
    /eventExportPayloadCacheKey\(\s*eventId,\s*format,\s*refreshMinutes/,
  );
  assert.match(cacheSource, /\["v5", "legacy"\] as const/);
  assert.match(cacheSource, /EVENT_EXPORT_CACHE_VERSION = 7/);
});
