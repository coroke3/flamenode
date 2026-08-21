import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  DEPLOY_GLOBAL_REBUILD_TARGETS,
  ensureDeployGlobalRebuilds,
  STATIC_LAST_GENERATOR_COMMIT_KV_KEY,
} from "./deployGlobalRebuildEnqueue.ts";

const source = await readFile(
  new URL("./deployGlobalRebuildEnqueue.ts", import.meta.url),
  "utf8",
);

const VALID_SHA = "a".repeat(40);

test("deploy 共有 global target 定数と enqueue 契約", () => {
  assert.deepEqual(DEPLOY_GLOBAL_REBUILD_TARGETS, [
    "list_recent",
    "list_popular",
    "search_index",
    "users_index",
    "top_recommended",
    "top_latest",
    "top_nostalgic",
    "top_events",
    "top_announcements",
    "top_stats",
    "top_slot_stats",
    "recommend_core",
    "events_index",
    "youtube_related_blocklist",
    "random_video_pool",
    "member_suggestions",
  ]);
  assert.equal(STATIC_LAST_GENERATOR_COMMIT_KV_KEY, "static:last_generator_commit");
  assert.match(source, /deploy_generator_change/);
  assert.match(source, /priority.*high/);
  assert.match(source, /target_id = 'global'/);
  assert.match(source, /INSERT OR IGNORE INTO static_rebuild_queue/);
  assert.match(source, /env\.KV\.get/);
  assert.match(source, /env\.KV\.put/);
});

function createFakeEnv({
  storedCommit = null,
  batchChanges = 1,
  pendingCount = null,
  failedCount = 0,
  allTargetsCovered = null,
} = {}) {
  const kvStore = new Map();
  if (storedCommit) {
    kvStore.set(STATIC_LAST_GENERATOR_COMMIT_KV_KEY, storedCommit);
  }
  const effectivePending =
    pendingCount ??
    (batchChanges > 0 ? DEPLOY_GLOBAL_REBUILD_TARGETS.length : 0);
  const effectiveAllCovered =
    allTargetsCovered ??
    effectivePending >= DEPLOY_GLOBAL_REBUILD_TARGETS.length;
  let batchCalls = 0;
  const env = {
    KV: {
      async get(key) {
        return kvStore.get(key) ?? null;
      },
      async put(key, value) {
        kvStore.set(key, value);
      },
    },
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          args: [],
          bind(...args) {
            statement.args = args;
            return statement;
          },
          async run() {
            return { meta: { changes: batchChanges } };
          },
          async first() {
            if (sql.includes("COUNT(DISTINCT target_type)")) {
              return {
                count: effectiveAllCovered
                  ? DEPLOY_GLOBAL_REBUILD_TARGETS.length
                  : Math.min(effectivePending, DEPLOY_GLOBAL_REBUILD_TARGETS.length - 1),
              };
            }
            if (sql.includes("status = 'failed'")) {
              return { count: failedCount };
            }
            if (sql.includes("COUNT(*)")) {
              return { count: effectivePending };
            }
            return null;
          },
        };
        return statement;
      },
      async batch(statements) {
        batchCalls += 1;
        return statements.map(() => ({ meta: { changes: batchChanges } }));
      },
    },
  };
  return { env, kvStore, getBatchCalls: () => batchCalls };
}

test("不正 commit は enqueue せず KV も更新しない", async () => {
  const { env, kvStore, getBatchCalls } = createFakeEnv();
  for (const commitSha of [undefined, "", "unknown", "not-a-commit"]) {
    const count = await ensureDeployGlobalRebuilds(env, { commitSha });
    assert.equal(count, 0);
  }
  assert.equal(getBatchCalls(), 0);
  assert.equal(kvStore.has(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), false);
});

test("同一 commit で failed がなければ enqueue せず 0 を返す", async () => {
  const { env, getBatchCalls } = createFakeEnv({ storedCommit: VALID_SHA });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(count, 0);
  assert.equal(getBatchCalls(), 0);
});

test("同一 commit でも deploy reason の failed があれば再 enqueue する", async () => {
  const { env, kvStore, getBatchCalls } = createFakeEnv({
    storedCommit: VALID_SHA,
    batchChanges: 1,
    failedCount: 2,
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getBatchCalls(), 1);
  assert.equal(count, DEPLOY_GLOBAL_REBUILD_TARGETS.length * 2);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), VALID_SHA);
});

test("commit 変化時は global target を enqueue し KV を更新する", async () => {
  const { env, kvStore, getBatchCalls } = createFakeEnv({
    storedCommit: "b".repeat(40),
    batchChanges: 1,
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getBatchCalls(), 1);
  assert.equal(count, DEPLOY_GLOBAL_REBUILD_TARGETS.length * 2);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), VALID_SHA);
});

test("batch changes が 0 で pending も 0 なら KV を更新せず 0 を返す", async () => {
  const { env, kvStore, getBatchCalls } = createFakeEnv({
    storedCommit: "b".repeat(40),
    batchChanges: 0,
    pendingCount: 0,
    allTargetsCovered: false,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getBatchCalls(), 1);
  assert.equal(count, 0);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), "b".repeat(40));
});

test("batch changes が 0 で全 target 未カバーなら KV を更新せず 0 を返す", async () => {
  const { env, kvStore, getBatchCalls } = createFakeEnv({
    storedCommit: "b".repeat(40),
    batchChanges: 0,
    pendingCount: 3,
    allTargetsCovered: false,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getBatchCalls(), 1);
  assert.equal(count, 0);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), "b".repeat(40));
});

test("batch changes が 0 でも全10件 pending なら KV を更新し wake 用に >0 を返す", async () => {
  const { env, kvStore, getBatchCalls } = createFakeEnv({
    storedCommit: "b".repeat(40),
    batchChanges: 0,
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
    allTargetsCovered: true,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getBatchCalls(), 1);
  assert.equal(count, DEPLOY_GLOBAL_REBUILD_TARGETS.length);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), VALID_SHA);
});

test("AbortSignal を尊重する", async () => {
  const controller = new AbortController();
  controller.abort();
  const { env } = createFakeEnv();
  await assert.rejects(
    () =>
      ensureDeployGlobalRebuilds(env, {
        commitSha: VALID_SHA,
        signal: controller.signal,
      }),
    /aborted/i,
  );
});
