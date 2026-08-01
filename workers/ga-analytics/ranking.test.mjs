import assert from "node:assert/strict";
import { test } from "node:test";
import { rankTrendingItems } from "./ranking.ts";

const recentItem = (id, title = "title") => ({
  id,
  title,
  youtube_video_id: "yt-" + id,
  display_name: "creator",
  icon_url: null,
  primary_event_id: null,
  primary_event_title: null,
  scheduled_time: 1_700_000_000,
  status: "public",
});

test("rankTrendingItems sorts by 2d then 5d/7d/30d then video_id", () => {
  const recent = {
    items: [
      recentItem("video-b", "B"),
      recentItem("video-a", "A"),
    ],
  };
  const periods = [
    {
      video_id: "video-a",
      views_2d: 11,
      views_5d: 0,
      views_7d: 0,
      views_30d: 30,
    },
    {
      video_id: "video-b",
      views_2d: 10,
      views_5d: 0,
      views_7d: 0,
      views_30d: 500,
    },
  ];

  const ranked = rankTrendingItems(recent, periods);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, "video-a");
  assert.equal(ranked[0].views_2d, 11);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].video_id, "video-a");
  assert.equal(ranked[1].id, "video-b");
  assert.equal(ranked[1].views_30d, 500);
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[1].video_id, "video-b");
});

test("rankTrendingItems excludes views_30d=0 and unknown recent ids", () => {
  const recent = { items: [recentItem("known")] };
  const periods = [
    {
      video_id: "known",
      views_2d: 1,
      views_5d: 1,
      views_7d: 1,
      views_30d: 1,
    },
    {
      video_id: "orphan",
      views_2d: 99,
      views_5d: 99,
      views_7d: 99,
      views_30d: 99,
    },
    {
      video_id: "zero",
      views_2d: 0,
      views_5d: 0,
      views_7d: 0,
      views_30d: 0,
    },
  ];

  const ranked = rankTrendingItems(recent, periods);
  assert.deepEqual(ranked.map((item) => item.id), ["known"]);
});
