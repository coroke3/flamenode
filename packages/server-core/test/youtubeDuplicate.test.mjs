import test from "node:test";
import assert from "node:assert/strict";
import { isYoutubeIdUniqueConstraintError as fromCore } from "@flamenode/server-core/video/youtubeDuplicate";
import { isYoutubeIdUniqueConstraintError as fromNextBridge } from "../../../src/lib/video/youtubeDuplicate.ts";

test("MIG-0651: the Next Server Action bridge resolves the same canonical implementation", () => {
  assert.strictEqual(fromNextBridge, fromCore);
});

test("MIG-0651: video YouTube unique conflicts keep CURRENT detection", () => {
  for (const error of [
    new Error("UNIQUE constraint failed: videos.youtube_video_id"),
    new Error("SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: videos_youtube_id_active_uniq"),
    "UNIQUE constraint failed: videos.youtube_video_id",
    new Error("unique constraint FAILED: VIDEOS.YOUTUBE_VIDEO_ID"),
  ]) {
    assert.equal(fromCore(error), true);
  }
});

test("MIG-0651: unrelated or non-unique DB failures are not mistaken for a duplicate YouTube video", () => {
  for (const error of [
    new Error("UNIQUE constraint failed: videos.id"),
    new Error("UNIQUE constraint failed: x_users.id"),
    new Error("CHECK constraint failed: videos.youtube_video_id"),
    new Error("no such table: videos"),
    new Error("SQLITE_BUSY: database is locked"),
    null,
    undefined,
    "",
  ]) {
    assert.equal(fromCore(error), false);
  }
});

test("MIG-0651: an index name alone does not imply a unique-constraint failure", () => {
  assert.equal(fromCore("constraint failed: videos_youtube_id_active_uniq"), false);
});
