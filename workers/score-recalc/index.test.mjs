import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  recalcScoreBatch,
  recalcScoreForVideoIds,
  SCORE_RECALC_BIND_CHUNK_SIZE,
  SCORE_FORCE_REFRESH_SEC,
  SCORE_RECALC_BATCH_SIZE,
} from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("スコア更新は1回150件以下に固定する", () => {
  assert.equal(SCORE_RECALC_BATCH_SIZE, 150);
  assert.equal(SCORE_FORCE_REFRESH_SEC, 72 * 60 * 60);
});

test("age-only force refresh は72時間（7日ではない）", () => {
  assert.equal(SCORE_FORCE_REFRESH_SEC, 72 * 60 * 60);
  assert.ok(SCORE_FORCE_REFRESH_SEC < 7 * 24 * 60 * 60);
  assert.match(source, /score_updated_at <= \?1 - \?2/);
  assert.match(source, /score_updated_at < v\.updated_at/);
  assert.match(source, /score_updated_at < COALESCE\(ym\.updated_at, 0\)/);
});

test("recalcScoreBatch は force refresh 秒数を bind する", async () => {
  let bound = [];
  await recalcScoreBatch({
    DB: {
      prepare() {
        return {
          bind(...args) {
            bound = args;
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
      },
    },
  });
  assert.equal(bound[1], SCORE_FORCE_REFRESH_SEC);
  assert.equal(bound[2], SCORE_RECALC_BATCH_SIZE);
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

test("recalcScoreForVideoIds は指定IDだけ更新する", async () => {
  let sql = "";
  const result = await recalcScoreForVideoIds({
    DB: {
      prepare(query) {
        sql = query;
        return {
          bind() { return this; },
          async run() { return { meta: { changes: 2 } }; },
        };
      },
    },
  }, ["video-a", "video-b"]);
  assert.match(sql, /WHERE id IN \(\?, \?\)/);
  assert.equal(result.processed, 2);
});

test("recalcScoreForVideoIds はD1の100 bind未満へ分割する", async () => {
  assert.equal(SCORE_RECALC_BIND_CHUNK_SIZE, 90);
  const calls = [];
  const result = await recalcScoreForVideoIds(
    {
      DB: {
        prepare(sql) {
          const call = { sql, bindings: [] };
          calls.push(call);
          return {
            bind(...bindings) {
              call.bindings = bindings;
              return this;
            },
            async run() {
              return { meta: { changes: call.bindings.length - 1 } };
            },
          };
        },
      },
    },
    Array.from({ length: 150 }, (_, index) => `video-${index}`),
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ bindings }) => bindings.length), [91, 61]);
  assert.ok(calls.every(({ bindings }) => bindings.length < 100));
  assert.equal(result.processed, 150);
});

test("score SQLはcanonical列だけを使う", () => {
  assert.doesNotMatch(source, /trending_view_count_24h/);
  assert.match(source, /video_youtube_metadata ym/);
  assert.match(source, /COALESCE\(app_like_count, 0\)/);
});
