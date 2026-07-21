import assert from "node:assert/strict";
import { test } from "node:test";
import { createCronWorker } from "./createCronWorker.ts";

const VALID_SHA = "A".repeat(40);

function workerFor(run = async () => {}) {
  return createCronWorker({ service: "test-cron", run });
}

test("healthはGET/HEADだけを許可し、有効な40桁commitをno-storeで返す", async () => {
  const worker = workerFor();
  const env = { BUILD_COMMIT_SHA: VALID_SHA };

  const getResponse = await worker.fetch(
    new Request("https://worker.example/health"),
    env,
  );
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await getResponse.json(), {
    ok: true,
    service: "test-cron",
    commit: VALID_SHA.toLowerCase(),
  });

  const headResponse = await worker.fetch(
    new Request("https://worker.example/health", { method: "HEAD" }),
    env,
  );
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.headers.get("cache-control"), "no-store");
  assert.equal(await headResponse.text(), "");

  const postResponse = await worker.fetch(
    new Request("https://worker.example/health", { method: "POST" }),
    env,
  );
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get("allow"), "GET, HEAD");
  assert.equal(postResponse.headers.get("cache-control"), "no-store");
});

test("healthはcommit未設定または不正時に値を露出せず503にする", async () => {
  const worker = workerFor();
  for (const BUILD_COMMIT_SHA of [undefined, "unknown", "g".repeat(40)]) {
    const response = await worker.fetch(
      new Request("https://worker.example/health"),
      { BUILD_COMMIT_SHA },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    assert.equal(payload.error, "build_commit_unavailable");
    assert.equal("commit" in payload, false);
  }
});

test("scheduledはCloudflareの予定時刻とAbortSignalをhandlerへ渡す", async () => {
  let received;
  let waitUntilPromise;
  const worker = workerFor(async (_env, context) => {
    received = context;
  });
  worker.scheduled(
    { scheduledTime: 1_721_177_520_000 },
    {},
    {
      waitUntil(promise) {
        waitUntilPromise = promise;
      },
    },
  );
  await waitUntilPromise;
  assert.equal(received.scheduledTime, 1_721_177_520_000);
  assert.ok(received.signal instanceof AbortSignal);
  assert.equal(received.signal.aborted, false);
});

test("scheduledは有限wall-clock deadlineでsignalをabortして失敗する", async () => {
  let receivedSignal;
  let waitUntilPromise;
  const worker = createCronWorker({
    service: "deadline-test",
    wallClockDeadlineMs: 10,
    run: async (_env, context) => {
      receivedSignal = context.signal;
      await new Promise(() => {});
    },
  });
  worker.scheduled(
    { scheduledTime: Date.now() },
    {},
    {
      waitUntil(promise) {
        waitUntilPromise = promise;
      },
    },
  );

  await assert.rejects(waitUntilPromise, /wall-clock deadline exceeded/);
  assert.equal(receivedSignal.aborted, true);
});
