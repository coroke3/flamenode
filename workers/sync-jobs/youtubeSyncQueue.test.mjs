import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  handleYoutubeSyncWakeQueue,
  isPlaylistSyncSlot,
} from "./index.ts";
import { createQueueWakeMessage } from "../../src/lib/queues/wakeMessage.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

function makeBatch(body) {
  const acked = [];
  return {
    messages: [{
      body,
      ack() { acked.push(body); },
      retry() {},
    }],
    acked,
  };
}

test("UTC分が52の時だけを再生リスト同期の専用枠にする", () => {
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:07:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:22:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:37:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:52:00Z")), true);
  assert.match(source, /mode:\s*"scheduled_only"/);
  assert.match(source, /includePending/);
  assert.match(source, /youtubeSyncEnabled/);
  assert.doesNotMatch(source, /22 \* \* \* \*/);
});

test("Queue consumer は pending only で Cron lease を使わない", () => {
  assert.match(source, /handleYoutubeSyncWakeQueue/);
  assert.match(source, /mode:\s*"pending_only"/);
  assert.match(source, /async queue\(/);
  assert.match(source, /recalcScoreForVideoIds/);
  assert.match(source, /wakeStaticRebuildAfterScoreEnqueue/);
  assert.match(source, /STATIC_REBUILD_WAKE_QUEUE/);
  assert.match(source, /maybeResendYoutubePendingWake/);
  const consumerBlock = source.slice(
    source.indexOf("export async function handleYoutubeSyncWakeQueue"),
    source.indexOf("export async function runSyncJobs"),
  );
  assert.doesNotMatch(consumerBlock, /withCronLease/);
});

test("quota不足時は continuation wake を送らない", () => {
  assert.match(source, /youtube\.has_more_pending && !youtube\.quota_stopped/);
});

test("wake メッセージに動画IDを載せない", () => {
  const message = createQueueWakeMessage({
    kind: "youtube_sync_pending",
    source: "web",
  });
  assert.equal("video_id" in message, false);
  assert.equal("youtube_video_id" in message, false);
  assert.deepEqual(Object.keys(message).sort(), [
    "kind",
    "requested_at",
    "source",
    "trace_id",
    "version",
  ]);
});

test("quota cooldown 中は continuation を送らない", async () => {
  const sent = [];
  const env = {
    BUILD_COMMIT_SHA: "a".repeat(40),
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
    YOUTUBE_API_KEY: "test-key",
    KV: {
      async get() {
        return String(Math.floor(Date.now() / 1000) + 3600);
      },
    },
    YOUTUBE_SYNC_WAKE_QUEUE: {
      async send(body) {
        sent.push(body);
      },
    },
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async all() { return { results: [] }; },
              async first() { return null; },
              async run() { return { meta: { changes: 0 } }; },
            };
          },
        };
      },
      async batch() { return []; },
    },
  };
  const batch = makeBatch(createQueueWakeMessage({
    kind: "youtube_sync_pending",
    source: "web",
  }));
  const result = await handleYoutubeSyncWakeQueue(batch, env);
  assert.equal(result.retryBatch, false);
  assert.equal(sent.length, 0);
  assert.equal(batch.acked.length, 1);
});

test("Queue consumer は metadata commit と post-commit を分離する", () => {
  assert.match(source, /youtube-sync-metadata/);
  assert.match(source, /runYoutubeSyncPostCommit/);
  assert.match(source, /score-recalc/);
  const consumerBlock = source.slice(
    source.indexOf("export async function handleYoutubeSyncWakeQueue"),
    source.indexOf("export async function runSyncJobs"),
  );
  assert.doesNotMatch(consumerBlock, /combineJobCounters\(youtube, score/);
});

test("Cron は metadata 失敗だけを throwIfJobFailed する", () => {
  const cronBlock = source.slice(
    source.indexOf("export async function runSyncJobs"),
  );
  assert.match(cronBlock, /youtube-sync-metadata/);
  assert.match(cronBlock, /runYoutubeSyncPostCommit/);
  assert.match(cronBlock, /throwIfJobFailed\([\s\S]*metadataJob/);
  assert.doesNotMatch(cronBlock, /combineJobCounters\(youtube, score/);
});

test("metadata成功後のscore失敗でもQueueはackする", async () => {
  const retried = [];
  const env = {
    BUILD_COMMIT_SHA: "a".repeat(40),
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
    YOUTUBE_API_KEY: "test-key",
    KV: { async get() { return null; } },
    YOUTUBE_SYNC_WAKE_QUEUE: { async send() {} },
    DB: {
      prepare(sql) {
        const statement = {
          bind() {
            return statement;
          },
          async all() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return {
                results: [{ used_units: 1 }],
                meta: { changes: 1 },
              };
            }
            if (sql.includes("ym.sync_status = 'pending'")) {
              return {
                results: [{ id: "video-1", youtube_video_id: "yt-1" }],
              };
            }
            if (sql.includes("video_id IN")) {
              return {
                results: [{
                  video_id: "video-1",
                  view_count: 0,
                  duration_seconds: 0,
                  youtube_privacy_status: null,
                  youtube_availability_status: null,
                  sync_status: "pending",
                }],
              };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes("COUNT(*)")) {
              return { pending_count: 0 };
            }
            return null;
          },
          async run() {
            if (sql.includes("SET score =")) {
              throw new Error("score update failed");
            }
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
      async batch() {
        return [{ meta: { changes: 1 } }];
      },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    items: [{
      id: "yt-1",
      statistics: { viewCount: "42" },
      status: { privacyStatus: "public" },
      contentDetails: { duration: "PT45S" },
    }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const batch = {
    messages: [{
      body: createQueueWakeMessage({
        kind: "youtube_sync_pending",
        source: "web",
      }),
      ack() {},
      retry() {
        retried.push(1);
      },
    }],
    acked: [],
  };

  try {
    const result = await handleYoutubeSyncWakeQueue(batch, env);
    assert.equal(result.retryBatch, false);
    assert.equal(retried.length, 0);
    assert.ok(result.processed >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pending 残あり・quota 正常時だけ continuation を送る", async () => {
  const sent = [];
  let fetchCalls = 0;
  const env = {
    BUILD_COMMIT_SHA: "a".repeat(40),
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
    YOUTUBE_API_KEY: "test-key",
    KV: { async get() { return null; } },
    YOUTUBE_SYNC_WAKE_QUEUE: {
      async send(body) {
        sent.push(body);
      },
    },
    DB: {
      prepare(sql) {
        const statement = {
          bind() {
            return statement;
          },
          async all() {
            if (sql.includes("INSERT INTO external_api_quota_usage")) {
              return {
                results: [{ used_units: 1 }],
                meta: { changes: 1 },
              };
            }
            if (sql.includes("ym.sync_status = 'pending'")) {
              return {
                results: [{ id: "video-1", youtube_video_id: "yt-1" }],
              };
            }
            if (sql.includes("video_id IN")) {
              return {
                results: [{
                  video_id: "video-1",
                  view_count: 0,
                  duration_seconds: 0,
                  youtube_privacy_status: null,
                  youtube_availability_status: null,
                  sync_status: "pending",
                }],
              };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes("COUNT(*)")) {
              return { pending_count: 3 };
            }
            return null;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
      async batch() {
        return [{ meta: { changes: 1 } }];
      },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      items: [{
        id: "yt-1",
        statistics: { viewCount: "99" },
        status: { privacyStatus: "public" },
        contentDetails: { duration: "PT45S" },
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const batch = makeBatch(createQueueWakeMessage({
      kind: "youtube_sync_pending",
      source: "web",
    }));
    const result = await handleYoutubeSyncWakeQueue(batch, env);
    assert.equal(result.retryBatch, false);
    assert.equal(result.continued, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].source, "continuation");
    assert.ok(fetchCalls >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
