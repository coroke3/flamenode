import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  classifyYoutubeApiError,
  isRetryableYoutubeStatus,
  normalizeYoutubeSyncCursor,
  orderYoutubeApiKeys,
  parseDuration,
  parseRetryAfterMs,
  resolveYoutubeApiKeys,
  shouldFailoverYoutubeApiKey,
  YOUTUBE_API_KEY_DISABLE_SEC,
  YOUTUBE_API_KEY_STATUS_KV,
  YOUTUBE_SYNC_BATCHES_PER_RUN,
  YOUTUBE_SYNC_BATCH_SIZE,
  YOUTUBE_SYNC_MAX_ATTEMPTS,
  YOUTUBE_SYNC_MAX_KEY_CANDIDATES,
} from "./index.ts";

const source = await readFile(
  new URL("./index.ts", import.meta.url),
  "utf8",
);

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

test("YouTube APIは1 Cron最大50 IDだけ処理する", () => {
  assert.equal(YOUTUBE_SYNC_BATCH_SIZE, 50);
  assert.equal(YOUTUBE_SYNC_BATCHES_PER_RUN, 1);
  assert.equal(
    YOUTUBE_SYNC_BATCH_SIZE * YOUTUBE_SYNC_BATCHES_PER_RUN,
    50,
  );
  assert.ok(YOUTUBE_SYNC_MAX_ATTEMPTS <= 2);
  assert.equal(YOUTUBE_SYNC_MAX_KEY_CANDIDATES, 2);
});

test("主キーと副キーを順序維持して重複排除する", () => {
  assert.deepEqual(
    resolveYoutubeApiKeys({
      YOUTUBE_API_KEY: " primary-key ",
      YOUTUBE_API_KEY_SECONDARY: " secondary-key ",
    }),
    [
      { label: "primary", key: "primary-key" },
      { label: "secondary", key: "secondary-key" },
    ],
  );
  assert.deepEqual(
    resolveYoutubeApiKeys({
      YOUTUBE_API_KEY: "same-key",
      YOUTUBE_API_KEY_SECONDARY: "same-key",
    }),
    [{ label: "primary", key: "same-key" }],
  );
});

test("credential障害中のキーを6時間回避する", () => {
  const candidates = resolveYoutubeApiKeys({
    YOUTUBE_API_KEY: "primary-key",
    YOUTUBE_API_KEY_SECONDARY: "secondary-key",
  });
  assert.equal(YOUTUBE_API_KEY_DISABLE_SEC, 6 * 60 * 60);
  assert.equal(YOUTUBE_API_KEY_STATUS_KV, "youtube-api:key-status:v1");
  assert.deepEqual(
    orderYoutubeApiKeys(
      candidates,
      { primary: 10_100 },
      10_000,
    ).map((candidate) => candidate.label),
    ["secondary"],
  );
  assert.deepEqual(
    orderYoutubeApiKeys(
      candidates,
      { primary: 9_999 },
      10_000,
    ).map((candidate) => candidate.label),
    ["primary", "secondary"],
  );
});

test("quota超過は副キーへ切り替えない", () => {
  assert.equal(
    classifyYoutubeApiError(403, "quotaExceeded"),
    "quota",
  );
  assert.equal(
    classifyYoutubeApiError(429, "rateLimitExceeded"),
    "quota",
  );
  assert.equal(
    shouldFailoverYoutubeApiKey(403, "quotaExceeded"),
    false,
  );
  assert.equal(
    shouldFailoverYoutubeApiKey(429, "rateLimitExceeded"),
    false,
  );
});

test("キー固有の障害だけ副キーへ切り替える", () => {
  assert.equal(
    classifyYoutubeApiError(400, "keyInvalid"),
    "credential",
  );
  assert.equal(
    classifyYoutubeApiError(403, "accessNotConfigured"),
    "credential",
  );
  assert.equal(
    shouldFailoverYoutubeApiKey(400, "keyInvalid"),
    true,
  );
  assert.equal(
    shouldFailoverYoutubeApiKey(403, "accessNotConfigured"),
    true,
  );
  assert.equal(shouldFailoverYoutubeApiKey(503, null), false);
});

test("候補抽出はpending・開催中・通常期限のindex queryへ分離する", () => {
  assert.match(
    source,
    /FROM video_youtube_metadata ym[\s\S]*ym\.sync_status = 'pending'/,
  );
  assert.match(source, /FROM events e[\s\S]*ACTIVE_SYNC_INTERVAL_SEC/);
  assert.match(
    source,
    /ym\.synced_at <= \?1 - \?2[\s\S]*DEFAULT_SYNC_INTERVAL_SEC/,
  );
  assert.doesNotMatch(
    source,
    /FROM videos v\s+LEFT JOIN video_youtube_metadata/,
  );
  assert.match(source, /最大3 query・50件/);
});

test("旧cursorは読み取り互換だけ維持する", () => {
  assert.equal(
    normalizeYoutubeSyncCursor(
      JSON.stringify({ last_video_id: " video-1 " }),
    ),
    "video-1",
  );
  assert.equal(normalizeYoutubeSyncCursor("broken"), "");
});

test("YouTube durationを秒へ変換する", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("invalid"), 0);
});
