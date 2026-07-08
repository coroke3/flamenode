import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStaticUserProfile } from "./staticUserProfileCore.ts";

test("normalizeStaticUserProfile: normalizes user profile payload", () => {
  const profile = normalizeStaticUserProfile({
    generated_at: 100,
    user: {
      id: "creator",
      x_name: "Creator",
      icon_url: "https://example.com/icon.png",
    },
    total_works: 2,
    recent_videos: [
      {
        id: "video1",
        title: "Video 1",
        youtube_video_id: "abcdefghijk",
        display_name: "Creator",
        creator_x_user_id: "creator",
      },
    ],
  });

  assert.ok(profile);
  assert.equal(profile.generatedAt, 100);
  assert.equal(profile.user.id, "creator");
  assert.equal(profile.totalWorks, 2);
  assert.equal(profile.recentVideos[0].display_name, "Creator");
});

test("normalizeStaticUserProfile: rejects payload without user id", () => {
  assert.equal(normalizeStaticUserProfile({ user: { x_name: "Creator" } }), null);
});
