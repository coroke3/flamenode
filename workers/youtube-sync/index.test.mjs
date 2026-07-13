import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  parseDuration,
  YOUTUBE_SYNC_BATCH_SIZE,
} from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("YouTube APIは1 Cron最大50 IDだけ処理する", () => {
  assert.equal(YOUTUBE_SYNC_BATCH_SIZE, 50);
  assert.doesNotMatch(source, /YOUTUBE_SYNC_BATCHES_PER_RUN/);
  assert.match(source, /fetchYoutubeJsonWithFailover/);
});

test("候補抽出はpending・開催中・通常期限のindex queryへ分離する", () => {
  assert.match(source, /FROM video_youtube_metadata ym[\s\S]*ym\.sync_status = 'pending'/);
  assert.match(source, /FROM events e[\s\S]*ACTIVE_SYNC_INTERVAL_SEC/);
  assert.match(source, /ym\.synced_at <= \?1 - \?2[\s\S]*DEFAULT_SYNC_INTERVAL_SEC/);
  assert.doesNotMatch(source, /FROM videos v\s+LEFT JOIN video_youtube_metadata/);
  assert.match(source, /最大3 query・50件/);
});

test("YouTube durationを秒へ変換する", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("invalid"), 0);
});
