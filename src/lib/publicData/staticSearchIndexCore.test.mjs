import assert from "node:assert/strict";
import test from "node:test";
import { searchStaticIndexVideos } from "./staticSearchIndexCore.ts";
import {
  buildStaticVideoSearchPostingArtifacts,
  normalizeStaticVideoSearchPostingManifest,
  normalizeStaticVideoSearchPostingPage,
  staticVideoSearchPostingDirectoryObjectKey,
  staticVideoSearchPostingObjectKeys,
  staticVideoSearchPostingPageObjectKey,
} from "./staticSearchIndexCore.ts";

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
  const sourceVideos = [
    { id: "v1", title: "Alpha Work", creator_display_name: "A" },
    { id: "v2", title: "Beta Work", creator_display_name: "B" },
  ];
  const page = searchStaticIndexVideos({
    payload: {
      videos: sourceVideos,
    },
    q: "work",
    sort: "old",
    page: 1,
    pageSize: 24,
  });
  assert.equal(page?.videos[0]?.id, "v2");
  assert.deepEqual(sourceVideos.map((video) => video.id), ["v1", "v2"]);
});

test("legacy search checks every public video field and registered creator name", () => {
  const payload = {
    videos: [{
      id: "video_unique",
      title: "Ordinary title",
      creator_display_name: "Display Unique",
      creator_x_user_id: "Creator_Handle",
      creator_x_user_name: "Embedded Alias",
      youtube_video_id: "YTUnique",
    }],
    users: [{ id: "creator_handle", x_name: "Registered Alias" }],
  };
  for (const query of [
    "ORDINARY",
    "display unique",
    "CREATOR_HANDLE",
    "YTUNIQUE",
    "VIDEO_UNIQUE",
    "registered alias",
    "EMBEDDED ALIAS",
  ]) {
    const page = searchStaticIndexVideos({
      payload,
      q: query,
      sort: "new",
      page: 1,
      pageSize: 24,
    });
    assert.equal(page?.total, 1, `query should match: ${query}`);
    assert.equal(page?.videos[0]?.id, "video_unique");
  }
});

test("video search posting はタイトル・X ID・日本語名を候補化し、世代を固定する", () => {
  const artifacts = buildStaticVideoSearchPostingArtifacts({
    generation: "g-video",
    generatedAt: 100,
    items: [
      {
        id: "v1",
        title: "東京の作品",
        youtube_video_id: "abc123",
        display_name: "Creator",
        creator_x_user_id: "tokyo_user",
        creator_x_user_name: "東京ユーザー",
      },
    ],
  });
  assert.equal(artifacts.manifest.generation, "videos-g-video");
  assert.deepEqual(
    normalizeStaticVideoSearchPostingManifest(artifacts.manifest),
    artifacts.manifest,
  );
  const page = artifacts.pages[0]?.page;
  assert.ok(page);
  assert.deepEqual(
    normalizeStaticVideoSearchPostingPage(page),
    page,
  );
});

test("manifest のページ数から、生成した directory・page の key を index を作らずに列挙できる", () => {
  const items = Array.from({ length: 400 }, (_, index) => ({
    id: `v${index}`,
    title: `東京の作品 ${index}`,
    youtube_video_id: null,
    display_name: `Creator ${index % 7}`,
    creator_x_user_id: `user_${index % 5}`,
    creator_x_user_name: null,
  }));
  const artifacts = buildStaticVideoSearchPostingArtifacts({
    generation: "g-keys",
    generatedAt: 100,
    items,
  });
  const built = [
    ...artifacts.directories.map(({ bucket }) =>
      staticVideoSearchPostingDirectoryObjectKey("g-keys", bucket),
    ),
    ...artifacts.pages.map(({ bucket, page }) =>
      staticVideoSearchPostingPageObjectKey("g-keys", bucket, page.page),
    ),
  ];
  const manifest = normalizeStaticVideoSearchPostingManifest(
    JSON.parse(JSON.stringify(artifacts.manifest)),
  );
  assert.ok(manifest?.page_counts);
  assert.deepEqual(
    staticVideoSearchPostingObjectKeys("g-keys", manifest.page_counts).sort(),
    built.sort(),
  );
});
