import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCAL_DATABASE_READ_CALLBACK_ATTEMPTS,
  WORKER_DATABASE_READ_CALLBACK_ATTEMPTS,
  runDatabaseReadCallback,
} from "./databaseReadRetryCore.ts";

function transientFailure() {
  return Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
}

test("Worker read callback does not replay completed reads when its final query fails", async () => {
  const reads = [0, 0, 0];
  await assert.rejects(
    runDatabaseReadCallback({
      resolve: () => ({ db: "worker" }),
      maxAttempts: WORKER_DATABASE_READ_CALLBACK_ATTEMPTS,
      run: async () => {
        reads[0] += 1;
        reads[1] += 1;
        reads[2] += 1;
        throw transientFailure();
      },
    }),
    /fetch failed/,
  );
  assert.deepEqual(reads, [1, 1, 1]);
});

test("local reconnect retry remains bounded and its replay is explicit", async () => {
  const reads = [0, 0, 0];
  let attempts = 0;
  let reconnects = 0;
  const result = await runDatabaseReadCallback({
    resolve: () => ({ db: "local" }),
    maxAttempts: LOCAL_DATABASE_READ_CALLBACK_ATTEMPTS,
    onRetry: () => { reconnects += 1; },
    wait: async () => {},
    run: async () => {
      attempts += 1;
      reads[0] += 1;
      reads[1] += 1;
      reads[2] += 1;
      if (attempts === 1) throw transientFailure();
      return "ok";
    },
  });
  assert.equal(result, "ok");
  assert.equal(reconnects, 1);
  assert.deepEqual(reads, [2, 2, 2]);
});

test("non-transient database errors never replay a callback", async () => {
  let calls = 0;
  await assert.rejects(
    runDatabaseReadCallback({
      resolve: () => ({ db: "local" }),
      maxAttempts: LOCAL_DATABASE_READ_CALLBACK_ATTEMPTS,
      run: async () => {
        calls += 1;
        throw new Error("constraint failed");
      },
    }),
    /constraint failed/,
  );
  assert.equal(calls, 1);
});
