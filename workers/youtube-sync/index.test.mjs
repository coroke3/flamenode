import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  isRetryableYoutubeStatus,
  parseDuration,
  parseRetryAfterMs,
  syncBatch,
  syncPendingBatch,
  YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN,
  YOUTUBE_METADATA_LOOKUP_CHUNK_SIZE,
  YOUTUBE_PENDING_MAX_API_BATCHES_PER_RUN,
  YOUTUBE_PENDING_MAX_VIDEOS_PER_RUN,
  YOUTUBE_SYNC_BATCH_SIZE,
  YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN,
  YOUTUBE_SYNC_MAX_ATTEMPTS,
  YOUTUBE_SYNC_MAX_ROWS_PER_RUN,
} from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("scheduled eligibility は既存 sync index 向けの直接列比較と malformed repair lane を使う", () => {
  assert.match(source, /const SYNCED_ELIGIBILITY_SQL = `ym\.synced_at`/);
  const scheduledSql = source.match(
    /const ACTIVE_PRIMARY_SYNCED_SQL[\s\S]*?const MALFORMED_SYNCED_SQL/,
  )?.[0] ?? "";
  assert.doesNotMatch(scheduledSql, /COALESCE\(ym\.synced_at/);
  assert.doesNotMatch(scheduledSql, /COALESCE\(ym\.updated_at/);
  assert.match(source, /AND \$\{SYNCED_ELIGIBILITY_SQL\} <= \?1 - \?2/);
  assert.match(source, /ORDER BY \$\{SYNCED_ELIGIBILITY_SQL\} ASC, v\.id ASC/);
  assert.match(source, /AND ym\.synced_at IS NULL/);
  const malformedSql = source.match(
    /const MALFORMED_SYNCED_SQL = `[^`]+`;/,
  )?.[0] ?? "";
  assert.match(malformedSql, /v\.visibility_status <> 'voided'/);
  assert.doesNotMatch(malformedSql, /NOT_BLOCKED_FOR_RELATED_SQL/);
  assert.match(source, /selectMalformedSyncedRows/);
  assert.match(source, /MALFORMED_SYNC_REPAIR_MAX_VIDEOS_PER_RUN = 10/);
});

test("secondary event lane は EXISTS で同一動画の複数 event 展開を抑止する", () => {
  const secondaryLanes = source.match(
    /const ACTIVE_VIDEO_EVENTS_(?:SYNCED|FAILED)_SQL = `[\s\S]*?LIMIT \?4`;/g,
  ) ?? [];
  assert.equal(secondaryLanes.length, 2);
  for (const lane of secondaryLanes) {
    assert.match(lane, /FROM video_youtube_metadata ym/);
    assert.match(lane, /AND EXISTS \(/);
    assert.match(lane, /FROM video_events ve/);
    assert.match(lane, /v\.primary_event_id IS NULL OR v\.primary_event_id <> e\.id/);
  }
  assert.match(source, /e\.visibility_status = 'public'/);
});

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
  assert.equal(YOUTUBE_PENDING_MAX_VIDEOS_PER_RUN, 50);
  assert.equal(YOUTUBE_PENDING_MAX_API_BATCHES_PER_RUN, 1);
  assert.equal(YOUTUBE_SYNC_MAX_ATTEMPTS, 2);
  assert.equal(YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN, 8);
  assert.ok(YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN < 50);
  assert.match(source, /for \(const chunk of chunks\)/);
  assert.doesNotMatch(source, /Promise\.all\([\s\S]*fetchYoutubeItems/);
});

test("pending only は最大50件・API batch 1件に固定する", () => {
  assert.match(source, /mode === "pending_only"/);
  assert.match(source, /selectPendingSyncRows/);
  assert.match(source, /changed_video_ids/);
  assert.match(source, /has_more_pending/);
});

test("Recovery Cronの既存metadata読取はD1の100 bind未満へ分割する", async () => {
  assert.equal(YOUTUBE_METADATA_LOOKUP_CHUNK_SIZE, 90);
  const { env, fetchImpl } = multiChunkEnv(200);

  await syncBatch(env, fetchImpl, undefined, {
    mode: "scheduled_only",
    includePending: true,
    maxVideos: 200,
    maxApiBatches: 1,
  });

  const lookupCalls = env.sqlCalls.filter(({ sql }) =>
    sql.includes("WHERE video_id IN")
  );
  assert.equal(lookupCalls.length, 3);
  assert.ok(
    lookupCalls.every(({ bindings }) =>
      bindings.length > 0 && bindings.length < 100
    ),
  );
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
  assert.match(source, /selectPendingSyncRows/);
  assert.match(source, /selectScheduledSyncRows/);
  assert.match(source, /ACTIVE_SYNC_INTERVAL_SEC/);
  assert.match(source, /DEFAULT_SYNC_INTERVAL_SEC/);
  assert.match(source, /video_events ve/);
  assert.match(source, /mergeScheduledSyncCandidates/);
  assert.doesNotMatch(source, /FROM videos v\s+LEFT JOIN video_youtube_metadata/);
});

test("scheduled再同期はpermanent失敗を両queryから除外する", () => {
  const failedLanes = source.match(
    /(?:DEFAULT_FAILED_SQL|ACTIVE_[A-Z_]+_FAILED_SQL)[\s\S]*?sync_error LIKE 'permanent:%'/g,
  ) ?? [];
  assert.equal(
    failedLanes.length,
    3,
    "all failed scheduled lanes must exclude permanent failures",
  );
});

test("通常同期はblockedを除外しfailed期限はupdated_atを使う", () => {
  assert.match(source, /NOT_BLOCKED_FOR_RELATED_SQL/);
  assert.match(source, /SYNCED_ELIGIBILITY_SQL/);
  assert.match(source, /FAILED_ELIGIBILITY_SQL/);
  assert.doesNotMatch(source, /SYNC_ELIGIBILITY_TIMESTAMP_SQL/);
  assert.match(source, /selectBlockedRecheckRows/);
  assert.match(source, /blocked_recheck_only/);
  assert.match(source, /related_eligibility_changed_video_ids/);
  assert.match(
    source,
    /excluded\.youtube_privacy_status IN \('public', 'unlisted'\)/,
  );
});

test("missing writeはavailabilityだけ変えmetricsを上書きしないSQLを持つ", () => {
  assert.match(source, /availabilityStatus: "missing_or_private"/);
  assert.match(
    source,
    /WHEN excluded\.youtube_availability_status IS NOT NULL/,
  );
  assert.match(
    source,
    /synced_at = CASE[\s\S]*IN \('public', 'unlisted'\)/,
  );
});

test("scheduled_only はpermanent failed行を再同期しない", async () => {
  const sqlCalls = [];
  let fetchCalls = 0;
  const env = {
    YOUTUBE_API_KEY: "test-key",
    KV: {
      async get() {
        return null;
      },
    },
    DB: {
      prepare(sql) {
        const statement = {
          bind(...bindings) {
            sqlCalls.push({ sql, bindings });
            return statement;
          },
          async all() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return {
                results: [{ used_units: 0 }],
                meta: { changes: 1 },
              };
            }
            if (sql.includes("sync_status = 'failed'")) {
              assert.match(sql, /sync_error LIKE 'permanent:%'/);
              return { results: [] };
            }
            if (sql.includes("sync_status = 'synced'")) {
              return { results: [] };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return { used_units: 0 };
            }
            return null;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
        return statement;
      },
      async batch() {
        return [];
      },
    },
  };

  const result = await syncBatch(
    env,
    async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    },
    undefined,
    { mode: "scheduled_only" },
  );

  assert.equal(result.processed, 0);
  assert.equal(fetchCalls, 0);
  assert.ok(
    sqlCalls.some(({ sql }) => sql.includes("sync_error LIKE 'permanent:%'")),
  );
});

test("synced_at=NULL は通常期限laneを汚染せず repair lane から再同期する", async () => {
  const sqlCalls = [];
  const batchCalls = [];
  const env = {
    YOUTUBE_API_KEY: "test-key",
    KV: {
      async get() {
        return null;
      },
    },
    DB: {
      prepare(sql) {
        const statement = {
          bind(...bindings) {
            sqlCalls.push({ sql, bindings });
            return statement;
          },
          async all() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return { results: [{ used_units: 0 }], meta: { changes: 1 } };
            }
            if (sql.includes("sync_status = 'pending'")) {
              return { results: [{ id: "pending-video", youtube_video_id: "pending-youtube-id" }] };
            }
            if (sql.includes("sync_status = 'synced'") && sql.includes("synced_at IS NULL")) {
              return { results: [{ id: "malformed-video", youtube_video_id: "malformed-youtube-id" }] };
            }
            if (sql.includes("WHERE video_id IN")) {
              return {
                results: [{
                  video_id: "malformed-video",
                  view_count: 1,
                  duration_seconds: 30,
                  youtube_privacy_status: "public",
                  youtube_availability_status: "public",
                  sync_status: "synced",
                }],
              };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return { used_units: 0 };
            }
            return null;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
      async batch(statements) {
        batchCalls.push(statements);
        return statements.map(() => ({ meta: { changes: 1 } }));
      },
    },
  };

  const result = await syncBatch(
    env,
    async () => new Response(JSON.stringify({
      items: [{
        id: "malformed-youtube-id",
        statistics: { viewCount: "10" },
        status: { privacyStatus: "public" },
        contentDetails: { duration: "PT30S" },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
    undefined,
    { mode: "scheduled_only", maxVideos: 1, maxApiBatches: 1 },
  );

  assert.equal(result.processed, 1);
  assert.ok(sqlCalls.some(({ sql }) =>
    sql.includes("sync_status = 'synced'") && sql.includes("synced_at IS NULL"),
  ));
  assert.ok(batchCalls.length >= 1);
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
        const statement = {
          bind(...bindings) {
            sqlCalls.push({ sql, bindings });
            return statement;
          },
          async all() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return {
                results: [{ used_units: 2 }],
                meta: { changes: 1 },
              };
            }
            if (sql.includes("sync_status = 'pending'")) {
              return {
                results: [{ id: "video-row", youtube_video_id: "youtube-id" }],
              };
            }
            if (sql.includes("WHERE video_id IN")) {
              return {
                results: [{
                  video_id: "video-row",
                  view_count: 0,
                  duration_seconds: 0,
                  youtube_privacy_status: null,
                  youtube_availability_status: null,
                  sync_status: "pending",
                }],
              };
            }
            return {
              results: [],
            };
          },
          async first() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return { used_units: 2 };
            }
            if (sql.includes("COUNT(*)")) {
              return { pending_count: 0 };
            }
            return null;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
        return statement;
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

  const result = await syncBatch(
    env,
    async () => new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.external_api_calls, 1);
  assert.ok(env.batchCalls.length >= 1);
});

test("pending only は view_count 変化分だけ changed_video_ids を返す", async () => {
  const env = metadataAbortEnv();
  const result = await syncPendingBatch(
    env,
    async () => new Response(JSON.stringify({
      items: [{
        id: "youtube-id",
        statistics: { viewCount: "120" },
        status: { privacyStatus: "public" },
        contentDetails: { duration: "PT1M" },
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(result.processed, 1);
  assert.deepEqual(result.changed_video_ids, ["video-row"]);
  assert.equal(result.has_more_pending, false);
});

function multiChunkEnv(videoCount = 51) {
  const sqlCalls = [];
  const batchCalls = [];
  let fetchCalls = 0;
  const rows = Array.from({ length: videoCount }, (_, index) => ({
    id: `video-${index + 1}`,
    youtube_video_id: `yt-${index + 1}`,
  }));
  const env = {
    sqlCalls,
    batchCalls,
    get fetchCalls() {
      return fetchCalls;
    },
    YOUTUBE_API_KEY: "test-key",
    KV: {
      async get() {
        return null;
      },
      async put() {},
    },
    DB: {
      prepare(sql) {
        const statement = {
          bind(...bindings) {
            sqlCalls.push({ sql, bindings });
            return statement;
          },
          async all() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return {
                results: [{ used_units: 2 }],
                meta: { changes: 1 },
              };
            }
            if (sql.includes("sync_status = 'pending'")) {
              return { results: rows };
            }
            if (sql.includes("WHERE video_id IN")) {
              const videoIds = sqlCalls.at(-1)?.bindings ?? [];
              return {
                results: videoIds.map((videoId) => ({
                  video_id: videoId,
                  view_count: 0,
                  duration_seconds: 0,
                  youtube_privacy_status: null,
                  youtube_availability_status: null,
                  sync_status: "pending",
                })),
              };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return { used_units: 2 };
            }
            if (sql.includes("COUNT(*)")) {
              return { pending_count: 0 };
            }
            return null;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
      async batch(statements) {
        batchCalls.push(statements);
        return statements.map(() => ({ meta: { changes: 1 } }));
      },
    },
  };

  let apiBatch = 0;
  const fetchImpl = async (input) => {
    fetchCalls += 1;
    apiBatch += 1;
    if (apiBatch === 1) {
      const ids = String(input).match(/id=([^&]+)/)?.[1]?.split(",") ?? [];
      return new Response(JSON.stringify({
        items: ids.map((id) => ({
          id,
          statistics: { viewCount: "10" },
          status: { privacyStatus: "public" },
          contentDetails: { duration: "PT30S" },
        })),
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      error: { errors: [{ reason: "quotaExceeded" }] },
    }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  };

  return { env, fetchImpl, rows };
}

test("先チャンクのmetadata保存後にquota停止しても成功分を保持する", async () => {
  assert.match(source, /committedWrites/);
  assert.match(source, /metadataD1Changes \+= await persistMetadataBatch/);
  assert.match(source, /if \(quotaStopped\) break/);

  const { env, fetchImpl } = multiChunkEnv(51);
  const result = await syncBatch(env, fetchImpl, undefined, {
    mode: "pending_only",
    maxApiBatches: 2,
    maxVideos: 100,
  });
  assert.ok(result.processed > 0, `expected partial metadata commit, got ${JSON.stringify(result)}`);
  assert.equal(result.quota_stopped, true);
  assert.equal(result.quota_stop_reason, "youtube_api_error");
  assert.ok(env.fetchCalls >= 2);
});

test("quota超過時は即時全件リトライせず部分成功で止まる", async () => {
  assert.match(source, /persistedVideoIds/);
  assert.match(source, /quotaStopped/);
  assert.match(source, /if \(quotaStopped\) break/);
});
