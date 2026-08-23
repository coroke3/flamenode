import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyEventExportPayload } from "./api/eventExportPayload.ts";

const event = {
  id: "event-legacy",
  title: "Legacy",
  explanation: null,
  icon_url: null,
  img_url: null,
  accent_color: null,
  event_type: "event",
  start_time: null,
  end_time: null,
  entry_start_time: null,
  entry_end_time: null,
  updated_at: 1,
  public_staff: [],
};

const baseVideo = {
  id: "legacy_abcdefghijk",
  title: "Legacy Video",
  primary_event_id: "event-legacy",
  event_ids: ["event-legacy"],
  collaboration_type: "individual",
  part: null,
  source_type: "youtube",
  creator_display_name: "Creator",
  creator_display_name_yomi: null,
  creator_x_user_id: "creator",
  creator_icon_url: null,
  creator_youtube_channel_url: null,
  creator_profile_text: null,
  creator_other_social_links: null,
  music: null,
  credit: null,
  music_reference_url: null,
  intro_comment: "上映前コメント",
  highlights: null,
  production_story:
    "ステージ利用: 同意する\n登壇: する\n制作経験: 4\nコメント: 一般コメント\n2行目",
  closing_comment: null,
  youtube_video_id: "abcdefghijk",
  scheduled_time: null,
  app_like_count: 0,
  score: 0,
  created_at: 1,
  updated_at: 1,
  members: [],
  chapters: [],
  softwares: [],
  answers: [],
};

function build(video) {
  return buildLegacyEventExportPayload({
    event,
    videos: [video],
    limit: 500,
    truncated: false,
  })[0];
}

test("legacy importがproduction_storyへ退避した旧列を互換出力で復元する", () => {
  const video = build(baseVideo);
  assert.equal(video.righttype, "同意する");
  assert.equal(video.toudan, "する");
  assert.equal(video.movieyear, "4");
  assert.equal(video.comment, "一般コメント\n2行目");
  assert.equal(video.beforecomment, "上映前コメント");
});

test("明示的なcanonical answerがlegacy import退避値より優先される", () => {
  const video = build({
    ...baseVideo,
    answers: [
      {
        key: "stage_permission",
        label: "上映可否",
        answer_text: "不可",
        answer_json: null,
        sort_order: 0,
      },
    ],
  });
  assert.equal(video.righttype, "不可");
});

test("通常作品のproduction_storyを旧メタデータとして誤解釈しない", () => {
  const video = build({
    ...baseVideo,
    id: "native-video",
    production_story: "ステージ利用: これは制作エピソード本文",
  });
  assert.equal(video.righttype, "");
  assert.equal(video.toudan, "");
  assert.equal(video.movieyear, "");
});
