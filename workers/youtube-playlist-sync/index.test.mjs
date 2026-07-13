import assert from "node:assert/strict";
import test from "node:test";
import { calculateSyncDiff } from "./index.ts";

const remote = [
  { playlist_item_id: "item-a", youtube_video_id: "video-a" },
  { playlist_item_id: "item-old", youtube_video_id: "video-old" },
];

test("append_only adds missing videos without deleting remote items", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "append_only");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, []);
});

test("missing videos preserve source schedule order", () => {
  const diff = calculateSyncDiff(
    ["video-first", "video-a", "video-middle", "video-last"],
    remote,
    "append_only",
  );
  assert.deepEqual(diff.additions, [
    "video-first",
    "video-middle",
    "video-last",
  ]);
});

test("mirror adds missing videos and removes videos outside the event", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "mirror");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, [remote[1]]);
});

