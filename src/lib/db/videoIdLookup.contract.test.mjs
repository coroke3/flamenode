import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const targets = await Promise.all([
  readFile(new URL("./listQueries.ts", import.meta.url), "utf8"),
  readFile(new URL("./videoDetailQueries.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../publicData/staticMissPolicy.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../publicData/degradedQueries.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../app/(public)/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../workers/json-generator/rebuild.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../video/internalId.ts", import.meta.url), "utf8"),
]);

test("動画 ID 参照は OR 結合を使わず二段 lookup へ集約する", () => {
  for (const source of targets) {
    assert.doesNotMatch(
      source,
      /eq\(videos\.id,[^)]+\),?\s*eq\(videos\.youtube_video_id/,
      "drizzle OR lookup should be removed",
    );
    assert.doesNotMatch(
      source,
      /WHERE v\.id = \? OR v\.youtube_video_id = \?/,
      "raw SQL OR lookup should be removed",
    );
  }
});

test("公開経路は videoIdLookup を参照する", () => {
  assert.match(targets[0], /resolveVideoPrimaryKey/);
  assert.match(targets[1], /fetchVideoRowByIdOrYoutube/);
  assert.match(targets[2], /resolveVideoPrimaryKey/);
  assert.match(targets[3], /fetchVideoRowByIdOrYoutube/);
  assert.match(targets[4], /fetchVideoRowByIdOrYoutube/);
  assert.match(targets[5], /fetchVideoRowForRebuild/);
  assert.match(targets[5], /isConfirmedInternalVideoId/);
  assert.match(targets[6], /isConfirmedInternalVideoId/);
});
