import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSyncDiff,
  planPlaylistOrderRepair,
} from "./index.ts";

const item = (id, videoId) => ({ playlistItemId: id, videoId });

test("投稿枠順と一致していればmanual itemを残してaligned", () => {
  assert.deepEqual(
    planPlaylistOrderRepair(
      ["video-a", "video-b", "video-c"],
      [
        item("manual-1", "manual-x"),
        item("a", "video-a"),
        item("manual-2", "manual-y"),
        item("b", "video-b"),
        item("c", "video-c"),
      ],
    ),
    { status: "aligned" },
  );
});

test("最初の逆転を前方moveする計画を作る", () => {
  assert.deepEqual(
    planPlaylistOrderRepair(
      ["video-a", "video-b", "video-c"],
      [
        item("manual", "manual-x"),
        item("b", "video-b"),
        item("a", "video-a"),
        item("c", "video-c"),
      ],
    ),
    {
      status: "move",
      playlistItemId: "a",
      videoId: "video-a",
      fromIndex: 2,
      toIndex: 1,
    },
  );
});

test("source itemの欠落や重複は誤ったmoveをせずambiguous", () => {
  assert.deepEqual(
    planPlaylistOrderRepair(
      ["video-a", "video-b"],
      [item("a-1", "video-a"), item("a-2", "video-a"), item("b", "video-b")],
    ),
    { status: "ambiguous" },
  );
  assert.deepEqual(
    planPlaylistOrderRepair(
      ["video-a", "video-b"],
      [item("a", "video-a")],
    ),
    { status: "ambiguous" },
  );
});

test("mirrorはイベント外項目だけでなくsource動画の重複も除去する", () => {
  const diff = calculateSyncDiff(
    ["video-a", "video-b"],
    [
      { playlist_item_id: "a-1", youtube_video_id: "video-a" },
      { playlist_item_id: "a-2", youtube_video_id: "video-a" },
      { playlist_item_id: "b", youtube_video_id: "video-b" },
      { playlist_item_id: "outside", youtube_video_id: "video-outside" },
    ],
    "mirror",
  );
  assert.deepEqual(diff.additions, []);
  assert.deepEqual(
    diff.removals.map((entry) => entry.playlist_item_id),
    ["a-2", "outside"],
  );
});

test("append_onlyはYouTube側の重複や手動追加を削除しない", () => {
  const diff = calculateSyncDiff(
    ["video-a"],
    [
      { playlist_item_id: "a-1", youtube_video_id: "video-a" },
      { playlist_item_id: "a-2", youtube_video_id: "video-a" },
      { playlist_item_id: "manual", youtube_video_id: "manual-x" },
    ],
    "append_only",
  );
  assert.deepEqual(diff, { additions: [], removals: [] });
});
