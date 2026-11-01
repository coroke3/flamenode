import test from "node:test";
import assert from "node:assert/strict";
import { buildFreeVideoRow } from "@flamenode/server-core/video/freeVideoRow";

const now = 1770000000;
const defaultArgs = {
  videoId: "v-123",
  eventId: null,
  activeX: "x-123",
  userId: "user-123",
  data: { is_collab: false, display_name: "Creator", title: "A new video" },
  iconUrl: null,
  creatorYoutubeChannelUrl: null,
  creatorOtherSocialLinks: null,
  youtubeId: "abcdefghijk",
  scheduledTime: now,
  now,
};

test("MIG-0651 U02: free videos row matches CURRENT complete 30-column default snapshot", () => {
  const row = buildFreeVideoRow(defaultArgs);
  assert.deepEqual(row, {
    id: "v-123",
    primary_event_id: null,
    creator_x_user_id: "x-123",
    submitted_by_user_id: "user-123",
    collaboration_type: "individual",
    part: null,
    source_type: "youtube",
    creator_display_name: "Creator",
    creator_display_name_yomi: null,
    creator_icon_url: null,
    creator_youtube_channel_url: null,
    creator_profile_text: null,
    creator_other_social_links: null,
    title: "A new video",
    music: null,
    credit: null,
    music_reference_url: null,
    closing_comment: null,
    youtube_video_id: "abcdefghijk",
    intro_comment: null,
    highlights: null,
    production_story: null,
    visibility_status: "public",
    scheduling_type: "manual",
    scheduled_time: now,
    app_like_count: 0,
    score: 0,
    score_updated_at: null,
    created_at: now,
    updated_at: now,
  });
  assert.equal(Object.keys(row).length, 30);
});
test("MIG-0651 U02: linked collaboration row retains all source fields and normalized values", () => {
  const row = buildFreeVideoRow({
    ...defaultArgs,
    eventId: "event-1",
    data: {
      is_collab: true, part: "  Finale  ", display_name: "Team",
      title: "Collaboration", profile_text: "We build", music: "Track",
      credit: "Team members", music_reference_url: "https://example.org/music",
      closing_comment: "End", intro_comment: "Hello",
      highlights: "Scene 2", production_story: "Behind the scenes",
    },
    iconUrl: "/api/media/icon.jpg",
    creatorYoutubeChannelUrl: "https://www.youtube.com/@team",
    creatorOtherSocialLinks: '[{"type":"X","url":"https://x.com/team"}]',
    scheduledTime: now + 3600,
  });
  assert.equal(row.primary_event_id, "event-1");
  assert.equal(row.collaboration_type, "collab");
  assert.equal(row.part, "Finale");
  assert.equal(row.creator_icon_url, "/api/media/icon.jpg");
  assert.equal(row.creator_youtube_channel_url, "https://www.youtube.com/@team");
  assert.equal(row.creator_other_social_links, '[{"type":"X","url":"https://x.com/team"}]');
  assert.equal(row.scheduled_time, now + 3600);
  assert.equal(row.creator_profile_text, "We build");
  assert.equal(row.music, "Track");
  assert.equal(row.credit, "Team members");
  assert.equal(row.music_reference_url, "https://example.org/music");
  assert.equal(row.closing_comment, "End");
  assert.equal(row.intro_comment, "Hello");
  assert.equal(row.highlights, "Scene 2");
  assert.equal(row.production_story, "Behind the scenes");
  assert.equal(row.created_at, now);
  assert.equal(row.updated_at, now);
});
test("MIG-0651 U02: null optional fields and blank part are retained, no input mutation", () => {
  const data = { ...defaultArgs.data, is_collab: false, part: "   ", music: null };
  const first = buildFreeVideoRow({ ...defaultArgs, data });
  const second = buildFreeVideoRow({ ...defaultArgs, data });
  assert.equal(first.part, null);
  assert.equal(first.music, null);
  assert.equal(data.part, "   ");
  assert.notStrictEqual(first, second);
});
