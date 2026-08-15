import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [loader, page] = await Promise.all([
  readFile(new URL("./videoReviewDetail.ts", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../../../app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("manage review detail combines video membership and projection reads", () => {
  assert.match(loader, /export async function fetchEventVideoReviewDetail/);
  assert.match(loader, /innerJoin\(videoEvents, eq\(videoEvents\.video_id, videos\.id\)\)/);
  assert.match(loader, /eq\(videoEvents\.event_id, eventId\)/);
  assert.match(page, /fetchEventVideoReviewDetail\(db, id, videoId\)/);
  assert.doesNotMatch(page, /select\(\{ id: videosTable\.id \}\)/);
});

test("review detail chunks event/question IN predicates for D1", () => {
  assert.match(loader, /D1_REVIEW_ID_CHUNK_SIZE = 80/);
  assert.match(loader, /for \(const eventIdChunk of chunkReviewIds\(normalizedEventIds\)\)/);
  assert.match(loader, /for \(const questionIdChunk of chunkReviewIds\(/);
});
