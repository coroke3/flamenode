import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  isRetryableYoutubeStatus,
  parseRetryAfterMs,
} from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

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

test("開催中イベントは最長1時間で次回同期対象へ戻す", () => {
  assert.match(source, /active_event:\s*number/);
  assert.match(source, /AS active_event/);
  assert.match(source, /if \(row\.active_event === 1\) return HOUR/);
});
