import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRetryableYoutubeStatus,
  normalizeYoutubeSyncCursor,
  parseDuration,
  parseRetryAfterMs,
  YOUTUBE_SYNC_BATCHES_PER_RUN,
  YOUTUBE_SYNC_BATCH_SIZE,
  YOUTUBE_SYNC_MAX_ATTEMPTS,
} from "./index.ts";

test("429と5xxは再試行対象", () => {
  assert.equal(isRetryableYoutubeStatus(429), true);
  assert.equal(isRetryableYoutubeStatus(503), true);
  assert.equal(isRetryableYoutubeStatus(400), false);
  assert.equal(isRetryableYoutubeStatus(404), false);
});

test("Retry-After秒指定をミリ秒へ変換", () => {
  assert.equal(parseRetryAfterMs("3"), 3_000);
});

test("Retry-Afterは上限を超えない", () => {
  assert.equal(parseRetryAfterMs("120"), 15_000);
});

test("YouTube APIの1リクエストは最大50 IDで構成する", () => {
  assert.equal(YOUTUBE_SYNC_BATCH_SIZE, 50);
  assert.equal(YOUTUBE_SYNC_BATCHES_PER_RUN, 4);
  assert.equal(YOUTUBE_SYNC_BATCH_SIZE * YOUTUBE_SYNC_BATCHES_PER_RUN, 200);
  assert.ok(YOUTUBE_SYNC_MAX_ATTEMPTS <= 2);
});

test("旧cursorは読み取り互換だけ維持する", () => {
  assert.equal(
    normalizeYoutubeSyncCursor(JSON.stringify({ last_video_id: " video-1 " })),
    "video-1",
  );
  assert.equal(normalizeYoutubeSyncCursor("broken"), "");
});

test("YouTube durationを秒へ変換する", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("invalid"), 0);
});
