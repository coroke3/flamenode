import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecommendViewModel,
  normalizeStaticRecommend,
} from "./staticRecommendCore.ts";

test("normalizeStaticRecommend は公開作品プールだけを返す", () => {
  const pools = normalizeStaticRecommend({
    generated_at: 1_700_000_000,
    recommended: [
      {
        id: "v1",
        title: "Recommended",
        display_name: "Creator",
        creator_x_user_id: "creator_a",
        primary_event_id: "event_a",
        status: "public",
      },
    ],
    latest: [],
    underrated: [],
    creators: [
      {
        id: "creator_a",
        x_name: "Creator A",
        video_count: 2,
        collab_count: 1,
      },
    ],
  });

  assert.ok(pools);
  assert.equal(pools.recommended[0].id, "v1");
  assert.equal(pools.creators[0].video_count, 2);
});

test("buildRecommendViewModel は hero と rail を組み立てる", () => {
  const pools = {
    recommended: [
      {
        id: "hero",
        title: "Hero",
        youtube_video_id: null,
        display_name: "A",
        creator_x_user_id: "a",
        primary_event_id: "e1",
        status: "public",
      },
      {
        id: "hot-1",
        title: "Hot",
        youtube_video_id: null,
        display_name: "A",
        creator_x_user_id: "a",
        primary_event_id: "e1",
        status: "public",
      },
    ],
    latest: [
      {
        id: "fresh-1",
        title: "Fresh",
        youtube_video_id: null,
        display_name: "B",
        creator_x_user_id: "b",
        primary_event_id: "e2",
        status: "public",
      },
    ],
    underrated: [],
    creators: [],
  };

  const view = buildRecommendViewModel(pools);
  assert.equal(view.hero?.id, "hero");
  assert.ok(view.hot.some((video) => video.id === "hot-1"));
  assert.ok(view.fresh.some((video) => video.id === "fresh-1"));
  assert.ok(view.eventsRail.some((video) => video.primary_event_id === "e2"));
});
