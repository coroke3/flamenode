import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  recalcScoreBatch,
  SCORE_FORCE_REFRESH_SEC,
  SCORE_RECALC_BATCH_SIZE,
} from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("スコア更新は1回150件以下に固定する", () => {
  assert.equal(SCORE_RECALC_BATCH_SIZE, 150);
  assert.equal(SCORE_FORCE_REFRESH_SEC, 24 * 60 * 60);
});

test("score result reports exact D1 changes and zero external metrics", async () => {
  const result = await recalcScoreBatch({
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async run() { return { meta: { changes: 7 } }; },
        };
      },
    },
  });
  assert.deepEqual(result, {
    processed: 7,
    failed: 0,
    skipped: 0,
    external_api_calls: 0,
    d1_changes: 7,
    retry_count: 0,
    quota_stopped: false,
    quota_stop_reason: null,
  });
});

test("score SQLはcanonical列だけを使う", () => {
  assert.doesNotMatch(source, /trending_view_count_24h/);
  assert.match(source, /video_youtube_metadata ym/);
  assert.match(source, /COALESCE\(app_like_count, 0\)/);
});
