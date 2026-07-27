import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./youtubeRelatedSharedInputsEnqueue.ts", import.meta.url),
  "utf8",
);

test("関連動画共有JSONは blocklist と random pool をセットで enqueue する", () => {
  assert.match(source, /youtube_related_blocklist/);
  assert.match(source, /random_video_pool/);
  assert.match(source, /YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY/);
  assert.match(source, /RANDOM_VIDEO_POOL_OBJECT_KEY/);
  assert.match(source, /ensureYoutubeRelatedSharedInputsOnR2/);
  assert.match(source, /env\.R2\.head/);
});
