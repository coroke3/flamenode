import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  isRetryableYoutubeStatus,
  parseDuration,
  parseRetryAfterMs,
  YOUTUBE_MAX_QUOTA_UNITS_PER_RUN,
  YOUTUBE_SYNC_BATCH_SIZE,
  YOUTUBE_SYNC_MAX_ATTEMPTS,
} from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

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

test("YouTube APIは1 Cron最大50 ID・2 quota unitsだけ処理する", () => {
  assert.equal(YOUTUBE_SYNC_BATCH_SIZE, 50);
  assert.equal(YOUTUBE_MAX_QUOTA_UNITS_PER_RUN, 2);
  assert.ok(YOUTUBE_SYNC_MAX_ATTEMPTS <= YOUTUBE_MAX_QUOTA_UNITS_PER_RUN);
  assert.doesNotMatch(source, /YOUTUBE_SYNC_BATCHES_PER_RUN/);
});

test("YouTube quota系403はKV cooldownで連続呼出しを止める", () => {
  assert.match(source, /YOUTUBE_QUOTA_COOLDOWN_KEY/);
  assert.match(source, /quotaCooldownActive/);
  assert.match(source, /activateQuotaCooldown/);
  assert.match(source, /quotaExceeded/);
  assert.match(source, /dailyLimitExceeded/);
});

test("YouTube応答は必要なfieldsだけ取得する", () => {
  assert.match(
    source,
    /fields[\s\S]*items\(id,statistics\/viewCount,status\/privacyStatus,contentDetails\/duration\)/,
  );
  assert.match(source, /prettyPrint[\s\S]*false/);
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
