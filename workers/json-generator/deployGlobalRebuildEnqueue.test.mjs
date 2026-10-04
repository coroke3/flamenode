import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  DEPLOY_GLOBAL_REBUILD_RETRY_REASON,
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
  assert.match(source, /reason,\s*"high",/);
  assert.match(source, /target_id = 'global'/);
  assert.match(source, /prepareStaticRebuildEnqueue\(\s*env\.DB,\s*globalTargets\(targets\)/);
  assert.match(source, /env\.KV\.get/);
  assert.match(source, /env\.KV\.put/);
  assert.equal(DEPLOY_GLOBAL_REBUILD_RETRY_REASON, "deploy_generator_change_retry");
  assert.match(source, /deploy_generator_change_retried/);
});

function createFakeEnv({
  storedCommit = null,
  batchChanges = 1,
  pendingCount = null,
  failedTargets = [],
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
  const writes = [];
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
            writes.push([statement]);
            return { meta: { changes: batchChanges } };
          },
          async all() {
            if (sql.includes("SELECT DISTINCT target_type")) {
              return {
                results: failedTargets.map((target_type) => ({ target_type })),
              };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes("COUNT(DISTINCT target_type)")) {
              return {
                count: effectiveAllCovered
                  ? DEPLOY_GLOBAL_REBUILD_TARGETS.length
                  : Math.min(effectivePending, DEPLOY_GLOBAL_REBUILD_TARGETS.length - 1),
              };
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
        writes.push(statements);
        return statements.map(() => ({ meta: { changes: batchChanges } }));
      },
    },
  };
  return { env, kvStore, writes, getWriteCalls: () => writes.length };
}

test("不正 commit は enqueue せず KV も更新しない", async () => {
  const { env, kvStore, getWriteCalls } = createFakeEnv();
  for (const commitSha of [undefined, "", "unknown", "not-a-commit"]) {
    const count = await ensureDeployGlobalRebuilds(env, { commitSha });
    assert.equal(count, 0);
  }
  assert.equal(getWriteCalls(), 0);
  assert.equal(kvStore.has(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), false);
});

test("deploy global enqueueは固定targetを1 statementのupsertへ縮約する", async () => {
  const { env, writes } = createFakeEnv({ batchChanges: 1 });

  await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 1);
  assert.match(writes[0][0].sql, /ON CONFLICT\(target_type, target_id\) WHERE status IN/);
});

test("同一 commit で failed がなければ enqueue せず 0 を返す", async () => {
  const { env, getWriteCalls } = createFakeEnv({ storedCommit: VALID_SHA });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(count, 0);
  assert.equal(getWriteCalls(), 0);
});

test("同一 commit でも deploy reason の failed があれば failed target だけを retry reason で再 enqueue する", async () => {
  const { env, kvStore, getWriteCalls } = createFakeEnv({
    storedCommit: VALID_SHA,
    batchChanges: 1,
    failedTargets: ["list_recent", "top_stats"],
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  });
  let batched = null;
  const originalBatch = env.DB.batch;
  env.DB.batch = async (statements) => {
    batched = statements;
    return originalBatch(statements);
  };
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getWriteCalls(), 1);
  // failed 行 UPDATE + upsert の2 statement（changes は enqueue 件数に含めない）。
  assert.equal(batched.length, 2);
  assert.equal(count, 1);
  assert.match(batched[0].sql, /SET reason = \?/);
  assert.deepEqual(batched[0].args, [
    "deploy_generator_change_retried",
    "list_recent",
    "top_stats",
    "deploy_generator_change",
  ]);
  assert.equal(batched[1].args[0], DEPLOY_GLOBAL_REBUILD_RETRY_REASON);
  const targetJson = JSON.parse(batched[1].args[3]);
  assert.deepEqual(
    targetJson.map((row) => row.target_type),
    ["list_recent", "top_stats"],
  );
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), VALID_SHA);
});

test("commit 変化時は global target を enqueue し KV を更新する", async () => {
  const { env, kvStore, getWriteCalls } = createFakeEnv({
    storedCommit: "b".repeat(40),
    batchChanges: 1,
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getWriteCalls(), 1);
  assert.equal(count, 1);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), VALID_SHA);
});

test("batch changes が 0 で pending も 0 なら KV を更新せず 0 を返す", async () => {
  const { env, kvStore, getWriteCalls } = createFakeEnv({
    storedCommit: "b".repeat(40),
    batchChanges: 0,
    pendingCount: 0,
    allTargetsCovered: false,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getWriteCalls(), 1);
  assert.equal(count, 0);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), "b".repeat(40));
});

test("batch changes が 0 で全 target 未カバーなら KV を更新せず 0 を返す", async () => {
  const { env, kvStore, getWriteCalls } = createFakeEnv({
    storedCommit: "b".repeat(40),
    batchChanges: 0,
    pendingCount: 3,
    allTargetsCovered: false,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getWriteCalls(), 1);
  assert.equal(count, 0);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), "b".repeat(40));
});

test("batch changes が 0 でも全10件 pending なら KV を更新し wake 用に >0 を返す", async () => {
  const { env, kvStore, getWriteCalls } = createFakeEnv({
    storedCommit: "b".repeat(40),
    batchChanges: 0,
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
    allTargetsCovered: true,
  });
  const count = await ensureDeployGlobalRebuilds(env, { commitSha: VALID_SHA });
  assert.equal(getWriteCalls(), 1);
  assert.equal(count, DEPLOY_GLOBAL_REBUILD_TARGETS.length);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), VALID_SHA);
});

const HASH_A = "1".repeat(64);
const HASH_B = "2".repeat(64);

test("同一 generator hash なら commit が変わっても enqueue せず KV も更新しない", async () => {
  const { env, kvStore, getWriteCalls } = createFakeEnv({ storedCommit: HASH_A });
  const count = await ensureDeployGlobalRebuilds(env, {
    commitSha: VALID_SHA,
    generatorHash: HASH_A,
  });
  assert.equal(count, 0);
  assert.equal(getWriteCalls(), 0);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), HASH_A);
});

test("同一 generator hash でも failed があれば failed target だけを1回再試行する", async () => {
  const { env, kvStore } = createFakeEnv({
    storedCommit: HASH_A,
    failedTargets: ["list_recent"],
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  });
  let batched = null;
  const originalBatch = env.DB.batch;
  env.DB.batch = async (statements) => {
    batched = statements;
    return originalBatch(statements);
  };
  const count = await ensureDeployGlobalRebuilds(env, {
    commitSha: "c".repeat(40),
    generatorHash: HASH_A,
  });
  assert.equal(batched.length, 2);
  assert.equal(batched[1].args[0], DEPLOY_GLOBAL_REBUILD_RETRY_REASON);
  assert.equal(count, 1);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), HASH_A);
});

test("generator hash が変わると 16 target を enqueue し KV に hash を保存する", async () => {
  const { env, kvStore, writes } = createFakeEnv({
    storedCommit: HASH_A,
    batchChanges: 1,
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  });
  await ensureDeployGlobalRebuilds(env, {
    commitSha: VALID_SHA,
    generatorHash: HASH_B.toUpperCase(),
  });
  assert.equal(writes.length, 1);
  assert.equal(DEPLOY_GLOBAL_REBUILD_TARGETS.length, 16);
  assert.equal(JSON.parse(writes[0][0].args[3]).length, 16);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), HASH_B);
});

test("旧 commit 値が KV に残っていても hash 初回 deploy は1回だけ enqueue する", async () => {
  const { env, kvStore, getWriteCalls } = createFakeEnv({
    storedCommit: VALID_SHA,
    batchChanges: 1,
    pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  });
  await ensureDeployGlobalRebuilds(env, {
    commitSha: VALID_SHA,
    generatorHash: HASH_A,
  });
  assert.equal(getWriteCalls(), 1);
  assert.equal(kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), HASH_A);
});

test("generator hash が未設定/不正なら commit SHA 判定へ fall back する", async () => {
  for (const generatorHash of [undefined, "", "unknown", "g".repeat(64), "a".repeat(63)]) {
    const same = createFakeEnv({ storedCommit: VALID_SHA });
    assert.equal(
      await ensureDeployGlobalRebuilds(same.env, { commitSha: VALID_SHA, generatorHash }),
      0,
    );
    assert.equal(same.getWriteCalls(), 0);

    const changed = createFakeEnv({
      storedCommit: "b".repeat(40),
      batchChanges: 1,
      pendingCount: DEPLOY_GLOBAL_REBUILD_TARGETS.length,
    });
    await ensureDeployGlobalRebuilds(changed.env, { commitSha: VALID_SHA, generatorHash });
    assert.equal(changed.getWriteCalls(), 1);
    assert.equal(changed.kvStore.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY), VALID_SHA);
  }
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
