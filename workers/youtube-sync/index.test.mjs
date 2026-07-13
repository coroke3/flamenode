import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRetryableYoutubeStatus,
  parseRetryAfterMs,
} from "./index.ts";

test("429と5xxは再試行対象", () => {
  assert.equal(
    isRetryableYoutubeStatus(429),
    true,
  );
  assert.equal(
    isRetryableYoutubeStatus(503),
    true,
  );
  assert.equal(
    isRetryableYoutubeStatus(400),
    false,
  );
  assert.equal(
    isRetryableYoutubeStatus(404),
    false,
  );
});

test("Retry-After秒指定をミリ秒へ変換", () => {
  assert.equal(parseRetryAfterMs("3"), 3_000);
});

test("Retry-Afterは上限を超えない", () => {
  assert.equal(parseRetryAfterMs("120"), 15_000);
});
