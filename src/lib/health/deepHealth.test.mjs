import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableName, isTable } from "drizzle-orm";
import * as dbSchema from "../db/schema.ts";
import {
  authorizeDeepHealth,
  runDeepHealthChecks,
} from "./deepHealth.ts";
import {
  REQUIRED_RUNTIME_TABLE_COUNT,
  RUNTIME_CRITICAL_TABLES,
} from "./schemaContract.ts";

const commit = "b".repeat(40);

test("runtime table contract covers every table exported by the canonical schema", () => {
  const exportedTables = Object.values(dbSchema)
    .filter(isTable)
    .map(getTableName)
    .sort();
  const contractedTables = RUNTIME_CRITICAL_TABLES.filter(
    (table) => table !== "d1_migrations",
  ).sort();
  assert.deepEqual(contractedTables, exportedTables);
});

test("deep health rejects missing and invalid bearer tokens", async () => {
  const request = new Request("https://example.com/api/health/deep");
  assert.equal(authorizeDeepHealth(request, undefined)?.status, 503);
  assert.equal(authorizeDeepHealth(request, "secret-token")?.status, 401);
});

test("deep health performs read-only D1, KV and R2 probes", async () => {
  const calls = [];
  const now = Math.floor(Date.now() / 1000);
  const env = {
    BUILD_COMMIT_SHA: commit,
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
    NOTIFICATION_WAKE_QUEUE: { send: () => {} },
    STATIC_REBUILD_WAKE_QUEUE: { send: () => {} },
    YOUTUBE_SYNC_WAKE_QUEUE: { send: () => {} },
    DB: {
      prepare(query) {
        calls.push(["d1", query]);
        return {
          first: async () => ({
            version: "2026-07-20-canonical-1",
            required_table_count: REQUIRED_RUNTIME_TABLE_COUNT,
          }),
        };
      },
    },
    KV: { get: async (key) => calls.push(["kv", key]) },
    BUCKET: {
      head: async (key) => calls.push(["r2", key]),
      get: async (key) => {
        calls.push(["r2-get", key]);
        const generatedAt = now - 60;
        if (key === "top.json") {
          return {
            text: async () =>
              JSON.stringify({
                generated_at: generatedAt,
                latest: [],
                stats: { public_videos: 0 },
              }),
          };
        }
        return {
          text: async () =>
            JSON.stringify({
              generated_at: generatedAt,
              total: 0,
              items: [],
            }),
        };
      },
    },
  };
  assert.deepEqual(await runDeepHealthChecks(env), {
    ok: true,
    service: "flamenode-web",
    commit,
    checks: {
      d1: "ok",
      kv: "ok",
      r2: "ok",
      schema: "ok",
      queues: "ok",
      static_artifacts: "ok",
    },
  });
  assert.deepEqual(calls.map(([kind]) => kind).sort(), ["d1", "kv", "r2", "r2-get", "r2-get"]);
});

test("deep health fails closed on schema mismatch", async () => {
  const env = {
    BUILD_COMMIT_SHA: commit,
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
    NOTIFICATION_WAKE_QUEUE: { send: () => {} },
    STATIC_REBUILD_WAKE_QUEUE: { send: () => {} },
    YOUTUBE_SYNC_WAKE_QUEUE: { send: () => {} },
    DB: { prepare: () => ({ first: async () => ({ version: "old" }) }) },
    KV: { get: async () => null },
    BUCKET: {
      head: async () => null,
      get: async () => null,
    },
  };
  await assert.rejects(() => runDeepHealthChecks(env), /schema version mismatch/);
});

test("deep health fails closed when any runtime table is missing", async () => {
  const env = {
    BUILD_COMMIT_SHA: commit,
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
    NOTIFICATION_WAKE_QUEUE: { send: () => {} },
    STATIC_REBUILD_WAKE_QUEUE: { send: () => {} },
    YOUTUBE_SYNC_WAKE_QUEUE: { send: () => {} },
    DB: {
      prepare: () => ({
        first: async () => ({
          version: "2026-07-20-canonical-1",
          required_table_count: REQUIRED_RUNTIME_TABLE_COUNT - 1,
        }),
      }),
    },
    KV: { get: async () => null },
    BUCKET: {
      head: async () => null,
      get: async () => null,
    },
  };
  await assert.rejects(
    () => runDeepHealthChecks(env),
    /required runtime table mismatch/,
  );
});
