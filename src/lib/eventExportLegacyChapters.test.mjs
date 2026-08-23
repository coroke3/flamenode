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
  id: "video-legacy",
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
  intro_comment: null,
  highlights: null,
  production_story: null,
  closing_comment: null,
  youtube_video_id: "abcdefghijk",
  scheduled_time: null,
  app_like_count: 0,
  score: 0,
  created_at: 1,
  updated_at: 1,
  members: [],
  softwares: [],
  answers: [],
};

test("個人作品はlegacy import由来のauthor未設定chapterからstartsを復元する", () => {
  const payload = buildLegacyEventExportPayload({
    event,
    videos: [
      {
        ...baseVideo,
        chapters: [
          {
            id: "chapter-1",
            x_user_id: null,
            chapter_time: 59,
            chapter_label: "",
            note: null,
          },
        ],
      },
    ],
    limit: 500,
    truncated: false,
  });

  assert.equal(payload[0].starts, "59");
  assert.equal(payload[0].ends, "");
});

test("X IDなし合作メンバーは同名chapterだけをstartsへ対応付ける", () => {
  const payload = buildLegacyEventExportPayload({
    event,
    videos: [
      {
        ...baseVideo,
        collaboration_type: "collab",
        members: [
          { x_user_id: null, name: "Member A", role_label: null, order_index: 0 },
          { x_user_id: "member_b", name: "Member B", role_label: null, order_index: 1 },
        ],
        chapters: [
          {
            id: "chapter-a",
            x_user_id: null,
            chapter_time: 12,
            chapter_label: "Member A",
            note: null,
          },
          {
            id: "chapter-b",
            x_user_id: "member_b",
            chapter_time: 34,
            chapter_label: "任意ラベル",
            note: null,
          },
        ],
      },
    ],
    limit: 500,
    truncated: false,
  });

  assert.equal(payload[0].starts, "12,34");
  assert.equal(payload[0].ends, ",");
});
