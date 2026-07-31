import assert from "node:assert/strict";
import { test } from "node:test";
import {
  markDone,
  markDoneOrSuppressRedelivery,
  markDoneWithRetries,
  markProcessing,
  markRetryOrFailed,
  reconcileStaleQueue,
  REBUILD_SUCCEEDED_AWAITING_DONE_MARK,
} from "./queue.ts";

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
            const [processedAt, updatedAt, id, token] = query.args;
            if (row.id !== id || row.status !== "processing" || row.lease_token !== token) {
              return { meta: { changes: 0 } };
            }
            const sourceUpdatedAt = Number(row.updated_at ?? 0);
            const processingStartedAt = Number(
              row.processing_started_at ?? row.updated_at ?? 0,
            );
            const wasRequeued = sourceUpdatedAt > processingStartedAt;
            Object.assign(row, {
              status: wasRequeued ? "pending" : "done",
              processed_at: wasRequeued ? null : processedAt,
              updated_at: wasRequeued ? sourceUpdatedAt : updatedAt,
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
