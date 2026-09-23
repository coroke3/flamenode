import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [source, rebuildSource] = await Promise.all([
  readFile(new URL("./youtubeRelatedSharedInputsEnqueue.ts", import.meta.url), "utf8"),
  readFile(new URL("./rebuild.ts", import.meta.url), "utf8"),
]);

test("YouTube availability fan-out はavailability依存artifactだけに限定する", () => {
  assert.match(source, /youtube_related_blocklist/);
  assert.match(source, /random_video_pool/);
  assert.match(source, /"top_nostalgic"/);
  assert.doesNotMatch(source, /"top_recommended"|"top_latest"|"top_stats"|"recommend_core"/);
  const nostalgic = rebuildSource.match(/async function loadTopNostalgicPool[\s\S]*?(?=\nasync function |\nexport async function )/)?.[0] ?? "";
  assert.match(nostalgic, /YOUTUBE_SYNCED_PLAYABLE_SQL/);
  assert.match(source, /YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY/);
  assert.match(source, /RANDOM_VIDEO_POOL_OBJECT_KEY/);
  assert.match(source, /ensureYoutubeRelatedSharedInputsOnR2/);
  assert.match(source, /env\.R2\.head/);
});

test("固定3 global targetと動画source targetはJSON1で一括enqueueする", () => {
  assert.match(source, /YOUTUBE_RELATED_REBUILD_MAX_D1_STATEMENTS = 2/);
  assert.match(source, /YOUTUBE_RELATED_SOURCE_VIDEO_BATCH_SIZE = 250/);
  assert.match(source, /YOUTUBE_RELATED_SOURCE_VIDEO_MAX_IDS = 2000/);
  assert.match(source, /const targetRows = \[/);
  assert.match(source, /sourceVideoIds\.map\(\(id\)/);
  assert.match(source, /FROM json_each\(\?\)/);
  assert.match(source, /env\.DB\.batch\(\[activeUpdate, insert\]\)/);
  assert.match(source, /youtube_related_video_source_target_limit_exceeded/);
  assert.match(source, /json_extract\(value, '\$\.target_id'\)/);
});

test("共有R2が両方存在する時はD1 enqueueを行わない", () => {
  assert.match(source, /env\.R2\.head\(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY\)/);
  assert.match(source, /env\.R2\.head\(RANDOM_VIDEO_POOL_OBJECT_KEY\)/);
  assert.match(source, /if \(blocklistHead && poolHead\) \{[\s\S]*?return 0/);
  assert.match(source, /return enqueueYoutubeRelatedProjectionRebuilds/);
});
