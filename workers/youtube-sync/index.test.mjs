import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  isRetryableYoutubeStatus,
  parseDuration,
  parseRetryAfterMs,
  syncBatch,
  YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN,
  YOUTUBE_SYNC_BATCH_SIZE,
  YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN,
  YOUTUBE_SYNC_MAX_ATTEMPTS,
  YOUTUBE_SYNC_MAX_ROWS_PER_RUN,
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

test("YouTube同期は1 Cron最大200 ID・外部request最大8件に固定する", () => {
  assert.equal(YOUTUBE_SYNC_BATCH_SIZE, 50);
  assert.equal(YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN, 4);
  assert.equal(YOUTUBE_SYNC_MAX_ROWS_PER_RUN, 200);
  assert.equal(YOUTUBE_SYNC_MAX_ATTEMPTS, 2);
  assert.equal(YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN, 8);
  assert.ok(YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN < 50);
  assert.match(source, /for \(const chunk of chunks\)/);
  assert.doesNotMatch(source, /Promise\.all\([\s\S]*fetchYoutubeItems/);
});

test("YouTube quotaはD1の日次80%予算を予約し未使用分を返却する", () => {
  assert.match(source, /reserveYoutubeQuota/);
  assert.match(source, /refundYoutubeQuota/);
  assert.match(source, /reservation\.reservedUnits - budget\.used/);
  assert.doesNotMatch(source, /YOUTUBE_API_KEY_SECONDARY/);
  assert.doesNotMatch(source, /runWithYoutubeApiKeyFailover/);
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
  assert.match(source, /合計200件/);
});

test("YouTube durationを秒へ変換する", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("invalid"), 0);
});

test("metadata SQLはcanonical列だけを使う", () => {
  const insertColumns = source.match(
    /INSERT INTO video_youtube_metadata \(([\s\S]*?)\) VALUES/,
  )?.[1] ?? "";
  assert.doesNotMatch(source, /ym\.youtube_video_id/);
  assert.doesNotMatch(insertColumns, /youtube_video_id/);
  assert.match(source, /INSERT INTO video_youtube_metadata \([\s\S]*video_id, youtube_privacy_status/);
});

function metadataAbortEnv() {
  const sqlCalls = [];
  const batchCalls = [];
  return {
    sqlCalls,
    batchCalls,
    YOUTUBE_API_KEY: "test-key",
    KV: {
      async get() {
        return null;
      },
    },
    DB: {
      prepare(sql) {
        return {
          bind(...bindings) {
            sqlCalls.push({ sql, bindings });
            return {
              async all() {
                if (sql.includes("INSERT INTO external_api_quota_usage")) {
                  return {
                    results: [{ used_units: 2 }],
                    meta: { changes: 1 },
                  };
                }
                return {
                  results: sql.includes("ym.sync_status = 'pending'")
                    ? [{ id: "video-row", youtube_video_id: "youtube-id" }]
                    : [],
                };
              },
              async first() {
                return sql.includes("INSERT INTO external_api_quota_usage")
                  ? { used_units: 2 }
                  : null;
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
      async batch(statements) {
        batchCalls.push(statements);
        return [];
      },
    },
  };
}

test("deadline中断はfetch再試行やmetadata D1書込みへ変換しない", async () => {
  const env = metadataAbortEnv();
  const controller = new AbortController();
  const deadline = new DOMException("deadline", "AbortError");
  let fetchCalls = 0;
  const abortingFetch = (_input, init = {}) => {
    fetchCalls += 1;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => reject(init.signal.reason ?? new DOMException("aborted", "AbortError")),
        { once: true },
      );
      controller.abort(deadline);
    });
  };

  await assert.rejects(
    () => syncBatch(env, abortingFetch, controller.signal),
    (error) => error === deadline,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(env.batchCalls.length, 0);
  assert.equal(
    env.sqlCalls.some(({ sql }) => sql.includes("UPDATE external_api_quota_usage")),
    false,
  );
});

test("非 quota 例外でも失敗までの API・D1 計数を保持する", async () => {
  const env = metadataAbortEnv();

  await assert.rejects(
    () => syncBatch(
      env,
      async () => new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
    (error) => {
      assert.equal(error?.name, "JobFailureWithCounters");
      assert.equal(error?.counters?.failed, 1);
      assert.equal(error?.counters?.external_api_calls, 1);
      assert.equal(error?.counters?.d1_changes, 2);
      assert.equal(error?.counters?.retry_count, 0);
      return true;
    },
  );
});
