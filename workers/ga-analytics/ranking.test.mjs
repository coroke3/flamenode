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

test("rankTrendingItems breaks 2d ties with views_5d", () => {
  const recent = {
    items: [recentItem("video-a"), recentItem("video-b")],
  };
  const periods = [
    { video_id: "video-a", views_2d: 10, views_5d: 5, views_7d: 0, views_30d: 1 },
    { video_id: "video-b", views_2d: 10, views_5d: 8, views_7d: 0, views_30d: 1 },
  ];
  const ranked = rankTrendingItems(recent, periods);
  assert.deepEqual(ranked.map((item) => item.id), ["video-b", "video-a"]);
});

test("rankTrendingItems breaks 5d ties with views_7d", () => {
  const recent = {
    items: [recentItem("video-a"), recentItem("video-b")],
  };
  const periods = [
    { video_id: "video-a", views_2d: 10, views_5d: 5, views_7d: 3, views_30d: 1 },
    { video_id: "video-b", views_2d: 10, views_5d: 5, views_7d: 9, views_30d: 1 },
  ];
  const ranked = rankTrendingItems(recent, periods);
  assert.deepEqual(ranked.map((item) => item.id), ["video-b", "video-a"]);
});

test("rankTrendingItems breaks 7d ties with views_30d", () => {
  const recent = {
    items: [recentItem("video-a"), recentItem("video-b")],
  };
  const periods = [
    { video_id: "video-a", views_2d: 10, views_5d: 5, views_7d: 7, views_30d: 20 },
    { video_id: "video-b", views_2d: 10, views_5d: 5, views_7d: 7, views_30d: 50 },
  ];
  const ranked = rankTrendingItems(recent, periods);
  assert.deepEqual(ranked.map((item) => item.id), ["video-b", "video-a"]);
});

test("rankTrendingItems breaks 30d ties with video_id ascending", () => {
  const recent = {
    items: [recentItem("video-z"), recentItem("video-a")],
  };
  const periods = [
    { video_id: "video-z", views_2d: 10, views_5d: 5, views_7d: 7, views_30d: 50 },
    { video_id: "video-a", views_2d: 10, views_5d: 5, views_7d: 7, views_30d: 50 },
  ];
  const ranked = rankTrendingItems(recent, periods);
  assert.deepEqual(ranked.map((item) => item.id), ["video-a", "video-z"]);
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

test("rankTrendingItems never promotes nonpublic recent rows to public", () => {
  const recent = {
    items: [
      recentItem("visible", "Visible"),
      { ...recentItem("private", "Private"), status: "private" },
      { ...recentItem("deleted", "Deleted"), status: "deleted" },
      { ...recentItem("unmarked", "Unmarked"), status: undefined },
    ],
  };
  const periods = recent.items.map((item) => ({
    video_id: item.id,
    views_2d: 10,
    views_5d: 10,
    views_7d: 10,
    views_30d: 10,
  }));
  const ranked = rankTrendingItems(recent, periods);
  assert.deepEqual(ranked.map((item) => item.id), ["visible"]);
  assert.equal(ranked[0].status, "public");
  assert.equal(ranked[0].rank, 1);
});

test("rankTrendingItems rejects a nonpublic duplicate without overwriting its public entry", () => {
  const recent = {
    items: [
      recentItem("visible", "Public title"),
      { ...recentItem("visible", "Private title"), status: "private" },
    ],
  };
  const ranked = rankTrendingItems(recent, [
    { video_id: "visible", views_2d: 1, views_5d: 1, views_7d: 1, views_30d: 1 },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, "Public title");
});

test("rankTrendingItems rejects non-finite, fractional and unsafe view counts", () => {
  const invalid = [NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10", null];
  const fields = ["views_2d", "views_5d", "views_7d", "views_30d"];
  const recent = { items: [recentItem("safe"), recentItem("invalid")] };
  const valid = {
    video_id: "safe", views_2d: 1, views_5d: 2, views_7d: 3, views_30d: 4,
  };
  for (const field of fields) {
    for (const value of invalid) {
      const ranked = rankTrendingItems(recent, [
        valid,
        { ...valid, video_id: "invalid", [field]: value },
      ]);
      assert.deepEqual(ranked.map((row) => row.id), ["safe"], `${field}=${String(value)}`);
    }
  }
  assert.deepEqual(rankTrendingItems(recent, [
    { ...valid, video_id: "invalid", views_30d: 0 },
  ]), []);
});
