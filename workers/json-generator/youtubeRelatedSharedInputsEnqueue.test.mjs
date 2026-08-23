import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./youtubeRelatedSharedInputsEnqueue.ts", import.meta.url),
  "utf8",
);

test("関連動画共有JSONは blocklist と random pool と top section をセットで enqueue する", () => {
  assert.match(source, /youtube_related_blocklist/);
  assert.match(source, /random_video_pool/);
  assert.match(source, /"top_recommended"/);
  assert.match(source, /"top_latest"/);
  assert.match(source, /"top_nostalgic"/);
  assert.match(source, /"top_stats"/);
  assert.match(source, /"recommend_core"/);
  assert.match(source, /YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY/);
  assert.match(source, /RANDOM_VIDEO_POOL_OBJECT_KEY/);
  assert.match(source, /ensureYoutubeRelatedSharedInputsOnR2/);
  assert.match(source, /env\.R2\.head/);
});

test("固定7 targetはJSON1のUPDATE+INSERT 2 statementsで一括enqueueする", () => {
  assert.match(source, /YOUTUBE_RELATED_REBUILD_MAX_D1_STATEMENTS = 2/);
  assert.match(source, /const targetRows = YOUTUBE_RELATED_PROJECTION_TARGETS\.map/);
  assert.match(source, /FROM json_each\(\?\)/);
  assert.match(source, /env\.DB\.batch\(\[activeUpdate, insert\]\)/);
  assert.doesNotMatch(source, /YOUTUBE_RELATED_PROJECTION_TARGETS\.flatMap/);
});

test("共有R2が両方存在する時はD1 enqueueを行わない", () => {
  assert.match(source, /env\.R2\.head\(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY\)/);
  assert.match(source, /env\.R2\.head\(RANDOM_VIDEO_POOL_OBJECT_KEY\)/);
  assert.match(source, /if \(blocklistHead && poolHead\) \{[\s\S]*?return 0/);
  assert.match(source, /return enqueueYoutubeRelatedProjectionRebuilds/);
});
