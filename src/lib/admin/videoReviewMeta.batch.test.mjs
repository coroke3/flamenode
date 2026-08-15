import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const metaSource = await readFile(
  new URL("./videoReviewMeta.ts", import.meta.url),
  "utf8");

test("fetchVideoReviewSummaries uses batch stage permission reader", () => {
  assert.match(metaSource, /batchReadStagePermissionCustomAnswers/);
  assert.doesNotMatch(metaSource, /readStagePermissionCustomAnswers/);
  assert.doesNotMatch(
    metaSource,
    /await readStagePermissionCustomAnswers/,
  );
});

test("event-scoped review summaries avoid rediscovering video membership and stay chunked", () => {
  assert.match(metaSource, /if \(eventId\) \{/);
  assert.match(metaSource, /eventIdsByVideo\.set\(videoId, \[eventId\]\)/);
  assert.match(metaSource, /D1_SAFE_VIDEO_ID_CHUNK_SIZE = 80/);
  assert.match(metaSource, /for \(const videoIdChunk of chunkIds\(uniqueVideoIds\)\)/);
});
