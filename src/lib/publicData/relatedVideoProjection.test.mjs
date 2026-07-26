import assert from "node:assert/strict";
import test from "node:test";
import {
  RELATED_DEFAULT_LIMIT,
  RELATED_MIN_LIMIT,
  resolveVisibleRelatedVideos,
} from "./relatedVideoProjection.ts";

function card(id) {
  return {
    id,
    title: id,
    youtube_video_id: id,
    display_name: id,
    icon_url: null,
    creator_x_user_id: null,
    primary_event_id: null,
    scheduled_time: null,
  };
}

test("同一seedで同一random配置", () => {
  const primary = Array.from({ length: 20 }, (_, i) => card(`p${i}`));
  const a = resolveVisibleRelatedVideos({
    primary,
    randomIds: ["p3", "p7"],
    currentVideoId: "self",
    seed: "seed-a",
  });
  const b = resolveVisibleRelatedVideos({
    primary,
    randomIds: ["p3", "p7"],
    currentVideoId: "self",
    seed: "seed-a",
  });
  assert.deepEqual(
    a.map((v) => v.id),
    b.map((v) => v.id),
  );
});

test("blockされたrandomをrandom reserveで置換し最大30件", () => {
  const primary = [card("r1"), card("r2"), ...Array.from({ length: 28 }, (_, i) => card(`p${i}`))];
  const result = resolveVisibleRelatedVideos({
    primary,
    reserve: Array.from({ length: 30 }, (_, i) => card(`g${i}`)),
    randomIds: ["r1", "r2"],
    randomReserve: [card("rr1"), card("rr2")],
    fallbackPool: Array.from({ length: 20 }, (_, i) => card(`f${i}`)),
    blockedIds: new Set(["r1"]),
    currentVideoId: "self",
    seed: "seed-b",
    minTarget: RELATED_MIN_LIMIT,
    maxTarget: RELATED_DEFAULT_LIMIT,
  });
  const ids = result.map((v) => v.id);
  assert.ok(!ids.includes("r1"));
  assert.ok(ids.includes("rr1") || ids.includes("r2"));
  assert.ok(ids.length <= RELATED_DEFAULT_LIMIT);
  assert.ok(ids.length >= RELATED_MIN_LIMIT);
  assert.equal(new Set(ids).size, ids.length);
});
