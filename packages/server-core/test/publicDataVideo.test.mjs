import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeStaticVideoCardBase,
  normalizePublicVideoCard,
  normalizePublicVideoCardList,
} from "../src/publicData/videoCardCore.ts";

import {
  normalizeStaticRecentVideoPage,
} from "../src/publicData/recentVideoCore.ts";

import {
  normalizeStaticPopularVideoPage,
} from "../src/publicData/popularVideoCore.ts";

import {
  STATIC_SEARCH_POSTINGS_SCHEMA_VERSION,
  normalizeStaticSearchPostingManifest,
  normalizeStaticSearchPostingDirectory,
  normalizeStaticSearchPostingPage,
  staticSearchPostingManifestObjectKey,
  staticSearchPostingDirectoryObjectKey,
  staticSearchPostingPageObjectKey,
  staticSearchPostingBucket,
  staticSearchQueryGrams,
} from "../src/publicData/searchPostingsCore.ts";

import {
  normalizeSearchVideo,
  staticSearchVideoMatchesQuery,
  toListVideo,
} from "../src/publicData/searchIndexCore.ts";

import {
  pageEventBaseVideos,
  isCompleteEventBasePool,
} from "../src/publicData/eventListCore.ts";

import {
  normalizeStaticEventDetail,
} from "../src/publicData/eventDetailCore.ts";

import {
  normalizeStaticVideoDetail,
} from "../src/publicData/videoDetailCore.ts";

import {
  EVENT_PLAYLIST_SCHEMA_VERSION,
  eventPlaylistObjectKey,
  normalizeStaticEventPlaylist,
} from "../src/publicData/eventPlaylistCore.ts";

import {
  canFallbackToDatabase,
  shouldUseStaticCollection,
} from "../src/publicData/loaderPolicy.ts";

test("videoCardCore normalizes card base and public cards", () => {
  const base = normalizeStaticVideoCardBase({
    id: "vid_1",
    title: "Video 1",
    youtube_video_id: "yt_1",
    display_name: "Author",
    icon_url: "https://example.com/icon.png",
    primary_event_id: "evt_1",
    scheduled_time: 1700000000,
  });
  assert.ok(base);
  assert.equal(base.id, "vid_1");
  assert.equal(base.display_name, "Author");

  const pub = normalizePublicVideoCard({
    id: "vid_1",
    title: "Video 1",
    status: "public",
    display_name: "Author",
  });
  assert.ok(pub);
  assert.equal(pub.status, "public");

  const nonPub = normalizePublicVideoCard({
    id: "vid_2",
    title: "Private Video",
    status: "private",
  });
  assert.equal(nonPub, null);

  const list = normalizePublicVideoCardList([
    { id: "v1", title: "V1", status: "public", display_name: "D1" },
    { id: "v2", title: "V2", status: "private" },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, "v1");
});

test("recentVideoCore & popularVideoCore slice pages properly", () => {
  const payload = {
    generated_at: 1700000000,
    total: 3,
    items: [
      { id: "v1", title: "V1", display_name: "D1", status: "public" },
      { id: "v2", title: "V2", display_name: "D2", status: "public" },
      { id: "v3", title: "V3", display_name: "D3", status: "public" },
    ],
  };

  const recentPage = normalizeStaticRecentVideoPage(payload, 2, 2);
  assert.ok(recentPage);
  assert.equal(recentPage.videos.length, 1);
  assert.equal(recentPage.videos[0]?.id, "v3");
  assert.equal(recentPage.total, 3);

  const popPage = normalizeStaticPopularVideoPage(payload, 1, 2);
  assert.ok(popPage);
  assert.equal(popPage.videos.length, 2);
  assert.equal(popPage.total, 3);
});

test("searchPostingsCore parses manifest and object keys", () => {
  assert.equal(STATIC_SEARCH_POSTINGS_SCHEMA_VERSION, 1);
  assert.equal(
    staticSearchPostingManifestObjectKey("gen_1"),
    "search-postings.v1/gen_1/manifest.json",
  );
  assert.equal(
    staticSearchPostingDirectoryObjectKey("gen_1", 2),
    "search-postings.v1/gen_1/directory/2.json",
  );
  assert.equal(
    staticSearchPostingPageObjectKey("gen_1", 2, 1),
    "search-postings.v1/gen_1/bucket/2/1.json",
  );

  const grams = staticSearchQueryGrams("hello");
  assert.ok(grams.length > 0);
  const bucket = staticSearchPostingBucket(grams[0]);
  assert.ok(bucket >= 0 && bucket < 16);

  const manifest = normalizeStaticSearchPostingManifest({
    schema_version: 1,
    generation: "gen_1",
    generated_at: 1700000000,
    total: 10,
    bucket_count: 16,
    backend: "postings-v1",
  });
  assert.ok(manifest);
  assert.equal(manifest.generation, "gen_1");

  const directory = normalizeStaticSearchPostingDirectory({
    schema_version: 1,
    generation: "gen_1",
    bucket: 0,
    grams: {
      he: { pages: [1], total: 1 },
    },
  });
  assert.ok(directory);
  assert.equal(directory.grams["he"]?.total, 1);
});

test("searchIndexCore normalizes search video and matches query", () => {
  const video = normalizeSearchVideo({
    id: "v1",
    title: "Video One",
    creator_display_name: "Creator",
  });
  assert.ok(video);
  assert.equal(video.id, "v1");
  assert.equal(video.display_name, "Creator");

  assert.equal(staticSearchVideoMatchesQuery(video, "Video"), true);
  assert.equal(staticSearchVideoMatchesQuery(video, "nomatch"), false);

  const listVideo = toListVideo(video);
  assert.equal(listVideo.id, "v1");
  assert.equal(listVideo.status, "public");
});

test("eventListCore pages event base videos", () => {
  const payload = {
    event: { id: "evt1", title: "Event 1", visibility_status: "public" },
    public_videos: [
      { id: "v1", title: "V1", display_name: "D1", scheduled_time: 100 },
      { id: "v2", title: "V2", display_name: "D2", scheduled_time: 200 },
    ],
    video_total: 2,
  };
  const paged = pageEventBaseVideos({
    payload,
    sort: "new",
    page: 1,
    pageSize: 10,
  });
  assert.ok(paged);
  assert.equal(paged.videos.length, 2);
  assert.equal(paged.total, 2);
  assert.equal(isCompleteEventBasePool(payload), true);
});

test("eventDetailCore & videoDetailCore normalizers", () => {
  const evtDetail = normalizeStaticEventDetail({
    schema_version: 1,
    generated_at: 1700000000,
    event: {
      id: "evt1",
      title: "Event One",
      visibility_status: "public",
    },
  });
  assert.ok(evtDetail);
  assert.equal(evtDetail.event.id, "evt1");

  const vidDetail = normalizeStaticVideoDetail({
    schema_version: 1,
    generated_at: 1700000000,
    video: {
      id: "vid1",
      title: "Video Detail",
      visibility_status: "public",
    },
  });
  assert.ok(vidDetail);
  assert.equal(vidDetail.video.id, "vid1");
  assert.equal(vidDetail.video.title, "Video Detail");
});

test("eventPlaylistCore & loaderPolicy", () => {
  assert.equal(EVENT_PLAYLIST_SCHEMA_VERSION, 1);
  assert.equal(eventPlaylistObjectKey("evt1"), "events/evt1/playlist.v1.json");

  const playlist = normalizeStaticEventPlaylist({
    schema_version: 1,
    generated_at: 1700000000,
    event_id: "evt1",
    complete: true,
    items: [
      { id: "v1", title: "V1", display_name: "D1", scheduled_time: 10 },
    ],
  });
  assert.ok(playlist);
  assert.equal(playlist.eventId, "evt1");
  assert.equal(playlist.items.length, 1);

  assert.equal(canFallbackToDatabase("static_json_with_live_overlay"), true);
  assert.equal(canFallbackToDatabase("static_only"), false);
  assert.equal(canFallbackToDatabase("maintenance"), false);

  assert.equal(shouldUseStaticCollection("static_json_with_live_overlay", 1), true);
  assert.equal(shouldUseStaticCollection("static_json_with_live_overlay", 0), false);
  assert.equal(shouldUseStaticCollection("static_only", 0), true);
});
