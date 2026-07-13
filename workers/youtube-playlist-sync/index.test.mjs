import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSyncDiff,
  parseDailyQuotaLimit,
  quotaDayKey,
} from "./index.ts";

const remote = [
  { playlist_item_id: "item-a", youtube_video_id: "video-a" },
  { playlist_item_id: "item-old", youtube_video_id: "video-old" },
];

test("append_only adds missing videos without deleting remote items", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "append_only");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, []);
});

test("mirror adds missing videos and removes videos outside the event", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "mirror");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, [remote[1]]);
});

test("daily quota stays conservative and bounded", () => {
  assert.equal(parseDailyQuotaLimit(undefined), 4500);
  assert.equal(parseDailyQuotaLimit("100"), 500);
  assert.equal(parseDailyQuotaLimit("5000"), 5000);
  assert.equal(parseDailyQuotaLimit("10000"), 8000);
  assert.equal(quotaDayKey(0), "1970-01-01");
});
