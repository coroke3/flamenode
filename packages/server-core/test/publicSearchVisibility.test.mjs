import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildStaticVideoSearchPostingArtifacts,
  normalizeSearchVideo,
  normalizeStaticVideoSearchPostingPage,
  searchStaticIndexVideos,
} from "../src/publicData/searchIndexCore.ts";

const row = (id, markers = {}) => ({
  id,
  title: `Common search title ${id}`,
  creator_display_name: "Creator",
  creator_x_user_id: "creator_a",
  youtube_video_id: "abcdefghijk",
  ...markers,
});

test("public search keeps legacy public-only artifacts and explicitly public rows", () => {
  for (const markers of [
    {},
    { status: null, visibility_status: null },
    { status: "public" },
    { visibility_status: "public" },
    { status: "public", visibility_status: "public" },
    { status: null, visibility_status: "public" },
    { status: "public", visibility_status: null },
  ]) {
    const normalized = normalizeSearchVideo(row("visible", markers));
    assert.ok(normalized, JSON.stringify(markers));
    assert.equal(normalized.id, "visible");
    assert.equal(normalized.title, "Common search title visible");
    assert.equal(normalized.display_name, "Creator");
  }
});

test("public search drops any explicitly revoked, draft or malformed visibility marker", () => {
  for (const markers of [
    { status: "private" },
    { visibility_status: "draft" },
    { status: "scheduled" },
    { status: "public", visibility_status: "private" },
    { status: "private", visibility_status: "public" },
    { status: "public", visibility_status: 0 },
    { status: false, visibility_status: "public" },
    { status: " Public " },
  ]) {
    assert.equal(normalizeSearchVideo(row("hidden", markers)), null, JSON.stringify(markers));
  }
});

test("public search excludes revoked records before pagination and total counts", () => {
  const page1 = searchStaticIndexVideos({
    payload: {
      generated_at: 1234,
      videos: [
        row("private", { status: "private" }),
        row("first"),
        row("conflict", { status: "public", visibility_status: "private" }),
        row("second", { visibility_status: "public" }),
        row("third", { status: "public" }),
      ],
    },
    q: "common",
    sort: "new",
    page: 1,
    pageSize: 2,
  });
  const page2 = searchStaticIndexVideos({
    payload: {
      videos: [
        row("private", { status: "private" }),
        row("first"),
        row("conflict", { status: "public", visibility_status: "private" }),
        row("second", { visibility_status: "public" }),
        row("third", { status: "public" }),
      ],
    },
    q: "common",
    sort: "new",
    page: 2,
    pageSize: 2,
  });
  assert.deepEqual(page1?.videos.map((video) => video.id), ["first", "second"]);
  assert.deepEqual(page2?.videos.map((video) => video.id), ["third"]);
  assert.equal(page1?.total, 3);
  assert.equal(page2?.total, 3);
  assert.equal(page1?.generatedAt, 1234);
  assert.ok(page1?.videos.every((video) => video.status === "public"));
});

test("public search posting reader rejects a tampered explicitly private record", () => {
  const item = normalizeSearchVideo(row("public", { status: "public" }));
  assert.ok(item);
  const artifacts = buildStaticVideoSearchPostingArtifacts({
    items: [item],
    generatedAt: 1234,
    generation: "search-visibility",
  });
  const original = artifacts.pages[0]?.page;
  assert.ok(original);
  assert.deepEqual(normalizeStaticVideoSearchPostingPage(original), original);

  const poisoned = structuredClone(original);
  poisoned.records[0].items[0].status = "public";
  poisoned.records[0].items[0].visibility_status = "private";
  assert.equal(
    normalizeStaticVideoSearchPostingPage(poisoned),
    null,
    "do not accept a posting page containing explicitly revoked metadata",
  );
});
