import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStaticEventDetail } from "./staticEventDetailCore.ts";

test("normalizeStaticEventDetail: event detail payload is shaped for static view", () => {
  const detail = normalizeStaticEventDetail({
    generated_at: 100,
    event: {
      id: "event1",
      title: "Event 1",
      explanation: "About",
      visibility_status: "public",
      start_time: 200,
    },
    public_staff: [
      {
        role: "representative",
        display_name: "Staff",
        x_user_id: "staff",
        x_name: "Staff Name",
      },
    ],
    slots_summary: [
      { status: "available", c: 2 },
      { status: "submitted", c: 3 },
    ],
    public_videos: [
      {
        id: "video1",
        title: "Video 1",
        youtube_video_id: "abcdefghijk",
        creator_display_name: "Creator",
      },
    ],
  });

  assert.ok(detail);
  assert.equal(detail.generatedAt, 100);
  assert.equal(detail.event.id, "event1");
  assert.equal(detail.publicStaff.length, 1);
  assert.equal(detail.slotSummary[1].count, 3);
  assert.equal(detail.publicVideos[0].creator_display_name, "Creator");
});

test("normalizeStaticEventDetail: rejects payload without event id", () => {
  assert.equal(
    normalizeStaticEventDetail({ event: { title: "Missing id" } }),
    null,
  );
});
