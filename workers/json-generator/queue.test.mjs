import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  markDone,
  markDoneOrSuppressRedelivery,
  markDoneWithRetries,
  markProcessing,
  markRetryOrFailed,
  reconcileStaleQueue,
  REBUILD_SUCCEEDED_AWAITING_DONE_MARK,
  STATIC_REBUILD_PROCESSING_LEASE_SEC,
} from "./queue.ts";

const queueSource = await readFile(new URL("./queue.ts", import.meta.url), "utf8");

test("processStaticRebuildQueue は既定で reconcile し Recovery option のみ抑止する", () => {
  assert.match(queueSource, /staleQueueAlreadyReconciled\?: boolean/);
  assert.match(queueSource, /!options\.staleQueueAlreadyReconciled/);
  assert.match(queueSource, /processStaticRebuildQueueImpl\(env, signal, options\)/);
});

test("static rebuild queue keeps one-at-a-time processing without Promise.all", () => {
  assert.doesNotMatch(queueSource, /PROCESSING_CONCURRENCY/);
  const processingLoop = queueSource.slice(
    queueSource.indexOf("for (const row of rows)"),
    queueSource.indexOf("\n\n  return {\n    ...summary"),
  );
  assert.match(processingLoop, /await processQueueRow\(/);
  assert.doesNotMatch(processingLoop, /Promise\.all/);
});

function fakeDb(row) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      const query = {
        sql,
        args: [],
        bind(...args) {
          query.args = args;
          return query;
        },
        async run() {
          queries.push({ sql, args: query.args });
          if (sql.includes("SET status = 'processing'")) {
            if (row.status !== "pending") return { meta: { changes: 0 } };
            row.status = "processing";
            row.processing_started_at = query.args[0];
            row.lease_token = query.args[1];
            row.lease_expires_at = query.args[2];
            row.updated_at = query.args[3];
            return { meta: { changes: 1 } };
          }

          if (
            sql.includes("SET status = CASE") &&
            sql.includes("processed_at = CASE") &&
            sql.includes("lease_token = ?")
          ) {
            const [
              forceFollowUp,
              ,
              processedAt,
              ,
              completedUpdatedAt,
              ,
              followUpReason,
              id,
              token,
            ] = query.args;
            if (row.id !== id || row.status !== "processing" || row.lease_token !== token) {
              return { meta: { changes: 0 } };
            }
            const sourceUpdatedAt = Number(row.updated_at ?? 0);
            const processingStartedAt = Number(
              row.processing_started_at ?? row.updated_at ?? 0,
            );
            const wasRequeued = sourceUpdatedAt > processingStartedAt;
            const forcedFollowUp = Number(forceFollowUp) === 1;
            Object.assign(row, {
              status: wasRequeued || forcedFollowUp ? "pending" : "done",
              processed_at: wasRequeued || forcedFollowUp ? null : processedAt,
              updated_at: wasRequeued
                ? sourceUpdatedAt
                : forcedFollowUp
                  ? Math.max(sourceUpdatedAt, processingStartedAt) + 1
                  : completedUpdatedAt,
              reason:
                forcedFollowUp && !wasRequeued
                  ? followUpReason
                  : row.reason,
              attempt_count: 0,
              error: null,
              processing_started_at: null,
              lease_token: null,
              lease_expires_at: null,
              next_retry_at: null,
            });
            return { meta: { changes: 1 } };
          }

          if (
            sql.includes("SET error = ?") &&
            sql.includes("lease_expires_at = ?") &&
            sql.includes("updated_at = ?")
          ) {
            const [error, leaseExpiresAt, updatedAt, id, token] = query.args;
            if (row.id !== id || row.status !== "processing" || row.lease_token !== token) {
              return { meta: { changes: 0 } };
            }
            Object.assign(row, {
              error,
              lease_expires_at: leaseExpiresAt,
              updated_at: updatedAt,
            });
            return { meta: { changes: 1 } };
          }

          if (
            sql.includes("SET status = 'done'") &&
            sql.includes("lease_expires_at <= ?") &&
            sql.includes("error = ?")
          ) {
            const [processedAt, updatedAt, now, marker] = query.args;
            if (
              row.status !== "processing" ||
              row.error !== marker ||
              Number(row.lease_expires_at ?? 0) > Number(now)
            ) {
              return { meta: { changes: 0 } };
            }
            Object.assign(row, {
              status: "done",
              processed_at: processedAt,
              attempt_count: 0,
              error: null,
              next_retry_at: null,
              processing_started_at: null,
              lease_token: null,
              lease_expires_at: null,
              updated_at: updatedAt,
            });
            return { meta: { changes: 1 } };
          }

          if (
            sql.includes("processing lease invalidated") &&
            sql.includes("lease_token IS NULL")
          ) {
            const [maxAttempts, boundedMax, terminalAt, retryAt, now, id] = query.args;
            if (row.id !== id || row.status !== "processing" || row.lease_token !== null) {
              return { meta: { changes: 0 } };
            }
            const nextAttempt = Number(row.attempt_count ?? 0) + 1;
            const terminal = nextAttempt >= Number(maxAttempts);
            Object.assign(row, {
              status: terminal ? "failed" : "pending",
              attempt_count: Math.min(nextAttempt, Number(boundedMax)),
              error: "processing lease invalidated",
              next_retry_at: nextAttempt >= Number(terminalAt) ? null : retryAt,
              processed_at: null,
              processing_started_at: null,
              lease_token: null,
              lease_expires_at: null,
              updated_at: now,
            });
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET status = 'failed'")) {
            const [, , , id, token] = query.args;
            if (row.id !== id || row.status !== "processing" || row.lease_token !== token) {
              return { meta: { changes: 0 } };
            }
            Object.assign(row, {
              status: "failed",
              attempt_count: query.args[0],
              error: query.args[1],
              updated_at: query.args[2],
              processing_started_at: null,
              lease_token: null,
              lease_expires_at: null,
              next_retry_at: null,
            });
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET status = 'pending'") && sql.includes("lease_token = NULL")) {
            const [, , , , id, token] = query.args;
            if (row.id !== id || row.status !== "processing" || row.lease_token !== token) {
              return { meta: { changes: 0 } };
            }
            Object.assign(row, {
              status: "pending",
              attempt_count: query.args[0],
              error: query.args[1],
              next_retry_at: query.args[2],
              processing_started_at: null,
              lease_token: null,
              lease_expires_at: null,
              updated_at: query.args[3],
            });
            return { meta: { changes: 1 } };
          }

          return { meta: { changes: 0 } };
        },
        async all() {
          const result = await query.run();
          if (
            sql.includes("RETURNING status") &&
            (result.meta?.changes ?? 0) === 1
          ) {
            return { ...result, results: [{ status: row.status }] };
          }
          return { ...result, results: [] };
        },
      };
      return query;
    },
  };
}

const envFor = (row) => ({ DB: fakeDb(row) });

test("claim and normal completion use one lease token", async () => {
  const row = { id: "srb-1", status: "pending" };
  const env = envFor(row);
  const token = await markProcessing(env, row.id, 100);
  assert.match(token, /^[0-9a-f-]{36}$/);
  assert.equal(row.status, "processing");
  assert.equal(await markDone(env, row.id, token, 110), true);
  assert.equal(row.status, "done");
  assert.equal(row.lease_token, null);
});

test("同じqueue itemの2/5/10回重複deliveryは1回だけclaimできる", async () => {
  for (const deliveries of [2, 5, 10]) {
    const row = { id: `srb-duplicate-${deliveries}`, status: "pending" };
    const env = envFor(row);
    const metrics = { d1_changes: 0 };
    const tokens = [];

    for (let delivery = 0; delivery < deliveries; delivery += 1) {
      tokens.push(await markProcessing(env, row.id, 100 + delivery, metrics));
    }

    assert.equal(tokens.filter(Boolean).length, 1);
    assert.equal(row.status, "processing");
    assert.equal(metrics.d1_changes, 1);
    assert.equal(await markDone(env, row.id, tokens.find(Boolean), 200, metrics), true);
    assert.equal(row.status, "done");

    for (let delivery = 0; delivery < deliveries; delivery += 1) {
      assert.equal(await markProcessing(env, row.id, 300 + delivery, metrics), null);
    }
    assert.equal(metrics.d1_changes, 2);
  }
});

test("processing lease outlives the 15-minute Queue/Cron invocation bound", async () => {
  const row = { id: "srb-max-runtime", status: "pending" };
  const env = envFor(row);
  await markProcessing(env, row.id, 100);
  assert.equal(STATIC_REBUILD_PROCESSING_LEASE_SEC, 16 * 60);
  assert.equal(row.lease_expires_at, 100 + STATIC_REBUILD_PROCESSING_LEASE_SEC);
  assert.ok(STATIC_REBUILD_PROCESSING_LEASE_SEC > 15 * 60);
});

test("claim and completion metrics count only queue mutations", async () => {
  const row = { id: "srb-metrics", status: "pending" };
  const env = envFor(row);
  const metrics = { d1_changes: 0 };
  const token = await markProcessing(env, row.id, 100, metrics);
  assert.equal(await markDone(env, row.id, token, 110, metrics), true);
  assert.equal(metrics.d1_changes, 2);
});

test("processing中の再enqueueは完了時にpendingへ戻す", async () => {
  const row = { id: "srb-requeued", status: "pending" };
  const env = envFor(row);
  const token = await markProcessing(env, row.id, 100);
  row.updated_at = 101;
  assert.equal(await markDoneWithRetries(env, row.id, token, 110), "requeued");
  assert.equal(row.status, "pending");
  assert.equal(row.processed_at, null);
  assert.equal(row.attempt_count, 0);
  assert.equal(row.lease_token, null);
});

test("users_index cleanup continuationは完了時にbounded follow-up理由でpendingへ戻す", async () => {
  const row = { id: "srb-users-index-gc", status: "pending", reason: "users_index_rebuild" };
  const env = envFor(row);
  const token = await markProcessing(env, row.id, 100);
  const processingStartedAt = row.processing_started_at;
  const result = await markDoneWithRetries(
    env,
    row.id,
    token,
    110,
    undefined,
    undefined,
    { followUpReason: "users_index_v2_gc_continuation:1" },
  );

  assert.equal(result, "requeued");
  assert.equal(row.status, "pending");
  assert.equal(row.reason, "users_index_v2_gc_continuation:1");
  assert.ok(row.updated_at > processingStartedAt);
  assert.equal(row.attempt_count, 0);
  assert.equal(row.lease_token, null);
});

test("users_index continuationの完了CAS SQLはSQLite上でreasonとleaseを正しく更新する", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE static_rebuild_queue (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      processing_started_at INTEGER,
      lease_token TEXT,
      updated_at INTEGER NOT NULL,
      processed_at INTEGER,
      reason TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      lease_expires_at INTEGER,
      next_retry_at INTEGER
    );
  `);
  sqlite.prepare(
    `INSERT INTO static_rebuild_queue
      (id, status, processing_started_at, lease_token, updated_at, reason, attempt_count)
     VALUES (?, 'processing', ?, ?, ?, ?, 3)`,
  ).run("srb-users-index-gc-sql", 100, "lease-token", 100, "users_index_rebuild");
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async all() {
                const results = sqlite.prepare(sql).all(...values);
                return { meta: { changes: results.length }, results };
              },
            };
          },
        };
      },
    },
  };

  try {
    assert.equal(
      await markDoneWithRetries(
        env,
        "srb-users-index-gc-sql",
        "lease-token",
        110,
        undefined,
        undefined,
        { followUpReason: "users_index_v2_gc_continuation:1" },
      ),
      "requeued",
    );
    const row = sqlite
      .prepare("SELECT * FROM static_rebuild_queue WHERE id = ?")
      .get("srb-users-index-gc-sql");
    assert.equal(row.status, "pending");
    assert.equal(row.reason, "users_index_v2_gc_continuation:1");
    assert.equal(row.updated_at, 101);
    assert.equal(row.attempt_count, 0);
    assert.equal(row.processing_started_at, null);
    assert.equal(row.lease_token, null);
  } finally {
    sqlite.close();
  }
});

test("users_index cleanup continuationは処理中に再enqueueされた理由を上書きしない", async () => {
  const row = { id: "srb-users-index-gc-race", status: "pending", reason: "users_index_rebuild" };
  const env = envFor(row);
  const token = await markProcessing(env, row.id, 100);
  row.updated_at = 105;
  row.reason = "visibility_change";

  assert.equal(
    await markDoneWithRetries(
      env,
      row.id,
      token,
      110,
      undefined,
      undefined,
      { followUpReason: "users_index_v2_gc_continuation:1" },
    ),
    "requeued",
  );
  assert.equal(row.status, "pending");
  assert.equal(row.updated_at, 105);
  assert.equal(row.reason, "visibility_change");
});

test("retry wait removes its abort listener after the timer completes", async () => {
  const row = {
    id: "srb-abort-listener",
    status: "processing",
    lease_token: null,
  };
  const env = envFor(row);
  const controller = new AbortController();
  let added = 0;
  let removed = 0;
  const originalAdd = controller.signal.addEventListener.bind(controller.signal);
  const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = ((...args) => {
    added += 1;
    return originalAdd(...args);
  });
  controller.signal.removeEventListener = ((...args) => {
    removed += 1;
    return originalRemove(...args);
  });

  assert.equal(
    await markDoneWithRetries(
      env,
      row.id,
      "stale-token",
      110,
      undefined,
      controller.signal,
    ),
    null,
  );
  assert.equal(added, 2);
  assert.equal(removed, 2);
});

test("stale completion returns an invalidated processing row to pending", async () => {
  const row = {
    id: "srb-2",
    status: "processing",
    lease_token: null,
    attempt_count: 0,
  };
  const env = envFor(row);
  assert.equal(await markDone(env, row.id, "stale-token", 200), false);
  assert.equal(row.status, "pending");
  assert.equal(row.processed_at, null);
  assert.equal(row.attempt_count, 1);
  const nextToken = await markProcessing(env, row.id, 201);
  assert.notEqual(nextToken, null);
  assert.equal(await markDone(env, row.id, nextToken, 202), true);
  assert.equal(row.status, "done");
});

test("a newer lease cannot be completed by an old token", async () => {
  const row = { id: "srb-3", status: "processing", lease_token: "new-token" };
  const env = envFor(row);
  assert.equal(await markDone(env, row.id, "old-token", 300), false);
  assert.equal(row.status, "processing");
  assert.equal(row.lease_token, "new-token");
});

test("retry and terminal failure clear the processing lease", async () => {
  const retryRow = {
    id: "srb-4",
    status: "processing",
    lease_token: "retry-token",
    attempt_count: 0,
  };
  await markRetryOrFailed(
    envFor(retryRow),
    retryRow,
    "retry-token",
    new Error("temporary"),
    400,
  );
  assert.equal(retryRow.status, "pending");
  assert.equal(retryRow.lease_token, null);

  const failedRow = {
    id: "srb-5",
    status: "processing",
    lease_token: "fail-token",
    attempt_count: 3,
  };
  await markRetryOrFailed(
    envFor(failedRow),
    failedRow,
    "fail-token",
    new Error("permanent"),
    500,
  );
  assert.equal(failedRow.status, "failed");
  assert.equal(failedRow.lease_token, null);
});

test("retry CAS loss caused by enqueue increments bounded attempts", async () => {
  const retryRow = {
    id: "srb-6",
    status: "processing",
    lease_token: null,
    attempt_count: 2,
  };
  await markRetryOrFailed(
    envFor(retryRow),
    retryRow,
    "old-token",
    new Error("temporary"),
    600,
  );
  assert.equal(retryRow.status, "pending");
  assert.equal(retryRow.attempt_count, 3);
  assert.equal(retryRow.next_retry_at, 660);
  assert.equal(retryRow.error, "processing lease invalidated");

  const failedRow = {
    id: "srb-7",
    status: "processing",
    lease_token: null,
    attempt_count: 3,
  };
  await markRetryOrFailed(
    envFor(failedRow),
    failedRow,
    "old-token",
    new Error("permanent"),
    700,
  );
  assert.equal(failedRow.status, "failed");
  assert.equal(failedRow.attempt_count, 4);
  assert.equal(failedRow.next_retry_at, null);
});

test("retry and lease recovery metrics count successful mutations", async () => {
  const retryRow = {
    id: "srb-metrics-retry",
    status: "processing",
    lease_token: "retry-token",
    attempt_count: 0,
  };
  const metrics = { d1_changes: 0 };
  await markRetryOrFailed(envFor(retryRow), retryRow, "retry-token", new Error("temporary"), 400, metrics);
  assert.equal(metrics.d1_changes, 1);

  const recoveredRow = {
    id: "srb-metrics-recover",
    status: "processing",
    lease_token: null,
    attempt_count: 0,
  };
  const recoveryMetrics = { d1_changes: 0 };
  assert.equal(await markDone(envFor(recoveredRow), recoveredRow.id, "stale", 401, recoveryMetrics), false);
  assert.equal(recoveryMetrics.d1_changes, 1);
});

test("expired processing leases are recovered with bounded attempts", async () => {
  const row = {
    id: "srb-8",
    status: "processing",
    attempt_count: 1,
    processing_started_at: 700,
    lease_token: "expired-token",
    lease_expires_at: 800,
  };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (!sql.includes("lease_expires_at <=")) {
                  return { meta: { changes: 0 }, args };
                }
                if (sql.includes("SET status = 'done'") && sql.includes("error = ?")) {
                  return { meta: { changes: 0 }, args };
                }
                assert.match(sql, /status = 'processing'/);
                assert.match(sql, /lease_expires_at <=/);
                assert.match(sql, /LIMIT/);
                row.status = "pending";
                row.attempt_count += 1;
                row.processing_started_at = null;
                row.lease_token = null;
                row.lease_expires_at = null;
                return { meta: { changes: 1 }, args };
              },
            };
          },
        };
      },
    },
  };
  const metrics = { d1_changes: 0 };
  await reconcileStaleQueue(env, 900, undefined, metrics);
  assert.equal(metrics.d1_changes, 1);
  assert.equal(row.status, "pending");
  assert.equal(row.attempt_count, 2);
  assert.equal(row.processing_started_at, null);
  assert.equal(row.lease_token, null);
});

test("invalidated processing crash is recovered and claimable in the same cron cycle", async () => {
  const row = {
    id: "srb-9",
    status: "processing",
    attempt_count: 2,
    processed_at: 123,
    error: "old error",
    next_retry_at: 456,
    processing_started_at: 700,
    lease_token: null,
    lease_expires_at: null,
  };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (sql.includes("SET status = 'processing'")) {
                  row.status = "processing";
                  row.processing_started_at = args[0];
                  row.lease_token = args[1];
                  row.lease_expires_at = args[2];
                  return { meta: { changes: 1 }, args };
                }
                if (sql.includes("status = 'processing' AND lease_token IS NULL")) {
                  assert.match(sql, /LIMIT/);
                  Object.assign(row, {
                    status: "pending",
                    attempt_count: 0,
                    processed_at: null,
                    error: null,
                    next_retry_at: null,
                    processing_started_at: null,
                  });
                  return { meta: { changes: 1 }, args };
                }
                return { meta: { changes: 0 }, args };
              },
            };
          },
        };
      },
    },
  };
  await reconcileStaleQueue(env, 900);
  const token = await markProcessing(env, row.id, 901);
  assert.notEqual(token, null);
  assert.equal(row.status, "processing");
  assert.equal(row.attempt_count, 0);
  assert.notEqual(row.lease_token, null);
});

test("rebuild成功後にmarkDoneが1回失敗してもretryでdoneへ進む", async () => {
  const row = { id: "srb-retry-done", status: "pending" };
  const env = envFor(row);
  let markDoneCalls = 0;
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    const query = originalPrepare(sql);
    const originalAll = query.all.bind(query);
    query.all = async () => {
      if (
        sql.includes("SET status = CASE") &&
        sql.includes("processed_at = CASE") &&
        sql.includes("lease_token = ?")
      ) {
        markDoneCalls += 1;
        if (markDoneCalls === 1) {
          return { meta: { changes: 0 }, results: [] };
        }
      }
      return originalAll();
    };
    return query;
  };
  const token = await markProcessing(env, row.id, 100);
  assert.equal(await markDoneWithRetries(env, row.id, token, 110), "done");
  assert.equal(row.status, "done");
  assert.equal(markDoneCalls, 2);
});

test("rebuild成功後にmarkDoneが常に失敗してもlease回復でdoneへ進む", async () => {
  const row = {
    id: "srb-suppress-redelivery",
    status: "processing",
    lease_token: "done-token",
    lease_expires_at: 120,
    processing_started_at: 100,
    updated_at: 100,
    attempt_count: 0,
  };
  const env = envFor(row);
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    const query = originalPrepare(sql);
    const originalAll = query.all.bind(query);
    query.all = async () => {
      if (
        sql.includes("SET status = CASE") &&
        sql.includes("processed_at = CASE") &&
        sql.includes("lease_token = ?")
      ) {
        return { meta: { changes: 0 }, results: [] };
      }
      return originalAll();
    };
    return query;
  };
  assert.equal(await markDoneWithRetries(env, row.id, row.lease_token, 110), null);
  assert.equal(await markDoneOrSuppressRedelivery(env, row.id, row.lease_token, 110), true);
  assert.equal(row.status, "processing");
  assert.equal(row.error, REBUILD_SUCCEEDED_AWAITING_DONE_MARK);

  row.lease_expires_at = 90;
  await reconcileStaleQueue(env, 100);
  assert.equal(row.status, "done");
  assert.equal(row.error, null);
  assert.equal(row.processed_at, 100);
});

test("successful rebuild markers beyond the recovery limit are not requeued", async () => {
  const recoveryLimit = 20;
  const rows = Array.from(
    { length: recoveryLimit + 1 },
    (_, index) => ({
      id: `marker-${index}`,
      status: "processing",
      attempt_count: 0,
      error: REBUILD_SUCCEEDED_AWAITING_DONE_MARK,
      lease_token: `token-${index}`,
      lease_expires_at: 1,
    }),
  );
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (
                  sql.includes("SET status = 'done'") &&
                  sql.includes("error = ?")
                ) {
                  const recoverable = rows
                    .filter((row) => row.status === "processing")
                    .slice(0, Number(args.at(-1)));
                  for (const row of recoverable) {
                    row.status = "done";
                    row.error = null;
                    row.lease_token = null;
                  }
                  return { meta: { changes: recoverable.length } };
                }
                if (
                  sql.includes("SET status = CASE") &&
                  sql.includes("lease_expires_at <=")
                ) {
                  assert.match(sql, /error IS NULL\s+OR error <> \?/);
                  assert.equal(args.at(-2), REBUILD_SUCCEEDED_AWAITING_DONE_MARK);
                  return { meta: { changes: 0 } };
                }
                return { meta: { changes: 0 } };
              },
            };
          },
        };
      },
    },
  };

  await reconcileStaleQueue(env, 900);
  assert.equal(rows.filter((row) => row.status === "done").length, recoveryLimit);
  assert.equal(rows.filter((row) => row.status === "processing").length, 1);
});

test("queue claim selects reason so optimizedRebuildTarget receives it", () => {
  // users_index forceRepair depends on the queued reason; without the column
  // row.reason is always undefined.
  assert.match(
    queueSource,
    /SELECT id, target_type, target_id, priority, attempt_count, updated_at, reason\s+FROM static_rebuild_queue/,
  );
  assert.match(queueSource, /reason: string \| null;/);
});
