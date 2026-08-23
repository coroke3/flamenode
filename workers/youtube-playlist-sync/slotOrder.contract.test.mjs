import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [worker, schema] = await Promise.all([
  readFile(new URL("./index.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../src/lib/db/schema.canonical.ts", import.meta.url),
    "utf8",
  ),
]);

test("YouTube再生リストのsourceは投稿枠を最優先し枠順で並ぶ", () => {
  assert.match(worker, /WITH event_videos AS \([\s\S]*FROM video_events[\s\S]*UNION[\s\S]*primary_event_id = \?1/);
  assert.match(worker, /LEFT JOIN slots s[\s\S]*s\.event_id = \?1[\s\S]*s\.video_id = v\.id[\s\S]*s\.status = 'submitted'/);
  assert.match(worker, /CASE WHEN COUNT\(s\.id\) > 0 THEN 0 ELSE 1 END/);
  assert.match(worker, /MIN\(CASE WHEN s\.start_time IS NULL THEN 9223372036854775807 ELSE s\.start_time END\)/);
  assert.match(worker, /MIN\(CASE WHEN s\.sort_order IS NULL THEN 2147483647 ELSE s\.sort_order END\)/);
  assert.match(worker, /MIN\(COALESCE\(v\.scheduled_time, v\.created_at\)\)/);
  assert.match(worker, /const sourcePositions = new Map\([\s\S]*sourceVideoIds\.map\(\(videoId, index\) => \[videoId, index\]\)/);
});

test("投稿枠順JOINは既存D1 indexを利用しschema-only最適化migrationを増やさない", () => {
  assert.match(schema, /index\("slots_event_idx"\)\.on\(t\.event_id, t\.start_time\)/);
  assert.match(schema, /index\("slots_video_idx"\)\.on\(t\.video_id\)/);
  assert.match(worker, /s\.event_id = \?1/);
  assert.match(worker, /s\.video_id = v\.id/);
});
