import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [worker, migration] = await Promise.all([
  readFile(new URL("./index.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../migrations/0060_youtube_playlist_slot_order_index.sql", import.meta.url),
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

test("投稿枠順JOINはD1の部分複合indexで支える", () => {
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "slots_playlist_order_idx"/);
  assert.match(migration, /ON "slots" \("event_id", "video_id", "start_time", "sort_order"\)/);
  assert.match(migration, /WHERE "status" = 'submitted' AND "video_id" IS NOT NULL/);
  assert.match(migration, /PRAGMA optimize/);
});
