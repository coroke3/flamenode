import assert from "node:assert/strict";
import test from "node:test";
import { searchStaticIndexVideos } from "./staticSearchIndexCore.ts";

test("searchStaticIndexVideos matches title and creator fields", () => {
  const page = searchStaticIndexVideos({
    payload: {
      generated_at: 100,
      videos: [
        {
          id: "v1",
          title: "Alpha Work",
          creator_display_name: "Creator A",
          creator_x_user_id: "creator_a",
          youtube_video_id: "yt1",
        },
        {
          id: "v2",
          title: "Beta Work",
          creator_display_name: "Other",
          creator_x_user_id: "other",
          youtube_video_id: "yt2",
        },
      ],
      users: [{ id: "creator_a", x_name: "Display A" }],
    },
    q: "alpha",
    sort: "new",
    page: 1,
    pageSize: 24,
  });
  assert.equal(page?.total, 1);
  assert.equal(page?.videos[0]?.id, "v1");
});

test("searchStaticIndexVideos can reverse for old sort", () => {
  const page = searchStaticIndexVideos({
    payload: {
      videos: [
        { id: "v1", title: "Alpha Work", creator_display_name: "A" },
        { id: "v2", title: "Beta Work", creator_display_name: "B" },
      ],
    },
    q: "work",
    sort: "old",
    page: 1,
    pageSize: 24,
  });
  assert.equal(page?.videos[0]?.id, "v2");
});
