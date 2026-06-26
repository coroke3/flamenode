import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEventApiPayload,
  EVENT_API_VIDEO_LIMIT,
  truncateForEventApi,
} from "./eventEndpointPayload.ts";

const NOW = 1_700_000_000;

test("truncateForEventApi: collapses whitespace and truncates long text", () => {
  assert.equal(truncateForEventApi("  a\n b\tc  "), "a b c");
  const out = truncateForEventApi("x".repeat(300), 10);
  assert.equal(out, "xxxxxxxxx…");
});

test("buildEventApiPayload: returns minimal event and video fields", () => {
  const payload = buildEventApiPayload(
    {
      id: "evt1",
      title: "Event",
      explanation: "説明",
      is_active: 1,
      is_entry_open: 0,
      is_archived: 0,
      start_time: NOW + 1000,
      end_time: NOW + 2000,
      entry_start_time: NOW - 100,
      entry_end_time: NOW + 100,
    },
    [
      {
        id: "v1",
        title: "Video",
        scheduled_time: 123,
        creator_display_name: "Creator",
        youtube_video_id: "abc",
      },
    ],
    undefined,
    NOW,
  );
  assert.deepEqual(payload, {
    event: {
      id: "evt1",
      title: "Event",
      explanation: "説明",
      is_active: true,
      is_entry_open: true,
      is_archived: false,
    },
    videos: [
      {
        id: "v1",
        title: "Video",
        scheduled_time: 123,
        creator_display_name: "Creator",
        youtube_video_id: "abc",
      },
    ],
    limit: EVENT_API_VIDEO_LIMIT,
  });
});

test("buildEventApiPayload: clamps video limit", () => {
  const videos = Array.from({ length: EVENT_API_VIDEO_LIMIT + 10 }, (_, i) => ({
    id: `v${i}`,
    title: `Video ${i}`,
    scheduled_time: null,
    creator_display_name: null,
    youtube_video_id: null,
  }));
  const payload = buildEventApiPayload(
    {
      id: "evt",
      title: "Event",
      explanation: null,
      is_active: 0,
      is_entry_open: 0,
      is_archived: 1,
      start_time: null,
      end_time: null,
      entry_start_time: null,
      entry_end_time: null,
    },
    videos,
    999,
  );
  assert.equal(payload.videos.length, EVENT_API_VIDEO_LIMIT);
  assert.equal(payload.limit, EVENT_API_VIDEO_LIMIT);
});
