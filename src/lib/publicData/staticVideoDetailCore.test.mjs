import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStaticVideoDetail } from "./staticVideoDetailCore.ts";

test("normalizeStaticVideoDetail: normalizes video and members", () => {
  const detail = normalizeStaticVideoDetail({
    generated_at: 100,
    video: {
      id: "video1",
      title: "Video 1",
      youtube_video_id: "abcdefghijk",
      creator_display_name: "Creator",
      visibility_status: "public",
    },
    event_ids: ["event1", ""],
    public_members: [
      { display_name: "Member", x_user_id: "member", order_index: 1 },
    ],
  });

  assert.ok(detail);
  assert.equal(detail.video.id, "video1");
  assert.deepEqual(detail.eventIds, ["event1"]);
  assert.equal(detail.publicMembers[0].display_name, "Member");
});

test("normalizeStaticVideoDetail: rejects payload without video title", () => {
  assert.equal(normalizeStaticVideoDetail({ video: { id: "video1" } }), null);
});
