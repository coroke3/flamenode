import assert from "node:assert/strict";
import test from "node:test";

import {
  eventListPayloadSupportsSort,
  isCompleteEventBasePool,
  isOversizedEventBasePool,
  pageEventBaseVideos,
  shouldEnqueueEventBaseListHeal,
} from "../src/publicData/eventListCore.ts";

const video = (id, markers = {}) => ({
  id,
  title: `Video ${id}`,
  creator_display_name: "Creator",
  scheduled_time: 100,
  score: 1,
  ...markers,
});
const eventPayload = (videos) => ({
  generated_at: 100,
  event: { id: "event-1", title: "Public Event", visibility_status: "public" },
  public_videos: videos,
  video_total: videos.length,
});
const page = (payload, sort = "new") =>
  pageEventBaseVideos({ payload, sort, page: 1, pageSize: 8, q: "" });

test("event-base public lists keep historical rows with absent/null visibility markers", () => {
  for (const markers of [
    {},
    { status: null, visibility_status: null },
    { status: "public" },
    { visibility_status: "public" },
    { status: "public", visibility_status: "public" },
    { status: null, visibility_status: "public" },
  ]) {
    const payload = eventPayload([video("visible", markers)]);
    assert.equal(isCompleteEventBasePool(payload), true, JSON.stringify(markers));
    assert.equal(shouldEnqueueEventBaseListHeal(payload, "new"), false);
    assert.deepEqual(page(payload)?.videos.map((row) => row.id), ["visible"]);
    assert.equal(page(payload)?.videos[0]?.status, "public");
    assert.equal(page(payload)?.total, 1);
  }
});

test("event-base rejects explicit private, draft, invalid and conflicting visibility markers", () => {
  for (const markers of [
    { status: "private" },
    { visibility_status: "private" },
    { status: "draft" },
    { status: "scheduled" },
    { status: "public", visibility_status: "private" },
    { status: "private", visibility_status: "public" },
    { status: "public", visibility_status: 0 },
    { status: false, visibility_status: "public" },
    { status: " Public " },
  ]) {
    const payload = eventPayload([video("revoked", markers)]);
    assert.equal(isCompleteEventBasePool(payload), false, JSON.stringify(markers));
    assert.equal(page(payload), null, JSON.stringify(markers));
    assert.equal(shouldEnqueueEventBaseListHeal(payload, "new"), true, JSON.stringify(markers));
  }
});

test("one revoked video invalidates the entire event base for both CURRENT and Hono readers", () => {
  const payload = eventPayload([
    video("good", { visibility_status: "public" }),
    video("revoked", { status: "public", visibility_status: "private" }),
    video("legacy"),
  ]);
  assert.equal(isOversizedEventBasePool(payload), false);
  assert.equal(isCompleteEventBasePool(payload), false);
  assert.equal(eventListPayloadSupportsSort(payload, "score"), true);
  assert.equal(shouldEnqueueEventBaseListHeal(payload, "score"), true);
  for (const sort of ["new", "old", "score"]) {
    assert.equal(page(payload, sort), null, `never project a partially revoked ${sort} list`);
  }
  assert.equal(payload.public_videos.length, 3, "normalization must not alter cached R2 rows");
});

test("event-base still fails closed for private events and preserves complete-page sorting", () => {
  const publicPayload = eventPayload([
    video("older", { status: "public", scheduled_time: 90, score: 10 }),
    video("newer", { scheduled_time: 110, score: 20 }),
  ]);
  assert.deepEqual(page(publicPayload, "new")?.videos.map((row) => row.id), ["newer", "older"]);
  assert.deepEqual(page(publicPayload, "old")?.videos.map((row) => row.id), ["older", "newer"]);
  assert.deepEqual(page(publicPayload, "score")?.videos.map((row) => row.id), ["newer", "older"]);
  const privatePayload = {
    ...publicPayload,
    event: { ...publicPayload.event, visibility_status: "private" },
  };
  assert.equal(page(privatePayload), null);
});
