import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVideoAuditSnapshot } from "./videoSavePlanCore.ts";

test("buildVideoAuditSnapshot uses fallback software label when provided", () => {
  const snapshot = buildVideoAuditSnapshot(
    {
      title: "t",
      youtube_video_id: "yt",
      creator_x_user_id: "x1",
      creator_display_name: "name",
      creator_icon_url: null,
      music: null,
      music_reference_url: null,
      credit: null,
      intro_comment: null,
      highlights: null,
      production_story: null,
      closing_comment: null,
      collaboration_type: "individual",
      part: null,
    },
    undefined,
    "After Effects",
  );
  assert.equal(snapshot.used_software, "After Effects");
});
