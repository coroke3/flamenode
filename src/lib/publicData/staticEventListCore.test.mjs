import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_LIST_POOL_MAX,
  eventListPayloadSupportsSort,
  isCompleteEventBasePool,
  pageEventBaseVideos,
} from "./staticEventListCore.ts";

function basePayload(videos, videoTotal = videos.length) {
  return {
    generated_at: 100,
    event: {
      id: "evt-1",
      title: "Test Event",
      visibility_status: "public",
    },
    public_videos: videos,
    video_total: videoTotal,
  };
}

test("isCompleteEventBasePool: video_total と pool 件数が一致するときのみ完全", () => {
  const videos = Array.from({ length: 3 }, (_, index) => ({
    id: `v${index}`,
    title: `Video ${index}`,
    creator_display_name: "Creator",
    visibility_status: "public",
    scheduled_time: index,
    score: index,
  }));
  assert.equal(isCompleteEventBasePool(basePayload(videos)), true);
  assert.equal(isCompleteEventBasePool(basePayload(videos, 10)), false);
  assert.equal(
    isCompleteEventBasePool(basePayload(videos, EVENT_LIST_POOL_MAX + 1)),
    false,
  );
});

test("eventListPayloadSupportsSort: composed JSON の score 欠落を検知する", () => {
  const withScore = basePayload([
    {
      id: "v1",
      title: "Alpha",
      creator_display_name: "Alice",
      scheduled_time: 1,
      score: 10,
    },
  ]);
  const withoutScore = basePayload([
    {
      id: "v1",
      title: "Alpha",
      creator_display_name: "Alice",
      scheduled_time: 1,
    },
  ]);
  assert.equal(eventListPayloadSupportsSort(withScore, "score"), true);
  assert.equal(eventListPayloadSupportsSort(withoutScore, "score"), false);
  assert.equal(eventListPayloadSupportsSort(withoutScore, "new"), true);
  assert.equal(eventListPayloadSupportsSort(basePayload([]), "score"), true);
});

test("pageEventBaseVideos: new / old / score と検索を R2 pool 上で処理する", () => {
  const videos = [
    {
      id: "v1",
      title: "Alpha",
      creator_display_name: "Alice",
      creator_x_user_id: "alice",
      visibility_status: "public",
      scheduled_time: 100,
      score: 10,
    },
    {
      id: "v2",
      title: "Beta",
      creator_display_name: "Bob",
      creator_x_user_id: "bob",
      visibility_status: "public",
      scheduled_time: 200,
      score: 50,
    },
    {
      id: "v3",
      title: "Gamma",
      creator_display_name: "Carol",
      creator_x_user_id: "carol",
      visibility_status: "public",
      scheduled_time: 150,
      score: 30,
    },
  ];
  const payload = basePayload(videos);

  const scorePage = pageEventBaseVideos({
    payload,
    sort: "score",
    page: 1,
    pageSize: 2,
  });
  assert.deepEqual(scorePage?.videos.map((row) => row.id), ["v2", "v3"]);

  const oldPage = pageEventBaseVideos({
    payload,
    sort: "old",
    page: 1,
    pageSize: 3,
  });
  assert.deepEqual(oldPage?.videos.map((row) => row.id), ["v1", "v3", "v2"]);

  const searchPage = pageEventBaseVideos({
    payload,
    sort: "new",
    page: 1,
    pageSize: 10,
    q: "bob",
  });
  assert.equal(searchPage?.total, 1);
  assert.equal(searchPage?.videos[0]?.id, "v2");
});
