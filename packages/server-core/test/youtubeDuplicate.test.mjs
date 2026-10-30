import test from "node:test";
import assert from "node:assert/strict";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { readFileSync } from "node:fs";
import { and, eq, ne } from "drizzle-orm";
import { videos } from "@flamenode/db/schema";
import { checkYoutubeVideoDuplicate, isYoutubeIdUniqueConstraintError as fromCore } from "@flamenode/server-core/video/youtubeDuplicate";
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

const dialect = new SQLiteSyncDialect();

test("MIG-0651: the CURRENT video-duplicate database helper retains exact canonical identity", () => {
  const legacySource = readFileSync(new URL("../../../src/lib/video/slotPart.ts", import.meta.url), "utf8");
  assert.match(legacySource, /export \\{ checkYoutubeVideoDuplicate \\} from "@flamenode\\/server-core\\/video\\/youtubeDuplicate"/);
});

test("MIG-0651: duplicate lookup retains voided exclusion, optional self exclusion, 1-row cap and SQL parameters", async () => {
  for (const excludeVideoId of [undefined, "video_self"]) {
    let whereClause;
    let limitValue;
    const db = {
      select: () => ({
        from: () => ({
          where: (condition) => ({
            limit: async (n) => {
              whereClause = condition;
              limitValue = n;
              return [{ id: "existing-video" }];
            },
          }),
        }),
      }),
    };
    assert.equal(await checkYoutubeVideoDuplicate(db, "youtube_id", excludeVideoId), true);
    assert.equal(limitValue, 1);
    const actual = dialect.sqlToQuery(whereClause);
    const originalPredicate = and(
      eq(videos.youtube_video_id, "youtube_id"),
      ne(videos.visibility_status, "voided"),
      excludeVideoId ? ne(videos.id, excludeVideoId) : undefined,
    );
    assert.deepEqual(actual, dialect.sqlToQuery(originalPredicate));
    assert.deepEqual(actual.params, excludeVideoId ? ["youtube_id", "voided", "video_self"] : ["youtube_id", "voided"]);
  }
});

test("MIG-0651: duplicate lookup returns false on an empty result, not a write", async () => {
  let reads = 0;
  const db = {
    select: () => {
      reads += 1;
      return { from: () => ({ where: () => ({ limit: async () => [] }) }) };
    },
  };
  assert.equal(await checkYoutubeVideoDuplicate(db, "not-found"), false);
  assert.equal(reads, 1);
});
