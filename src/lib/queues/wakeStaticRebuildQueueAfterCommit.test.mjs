import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createQueueWakeMessage,
  sendWorkerQueueWakeBestEffort,
} from "../../../workers/shared/queueWake.ts";

test("producer helper: static rebuild wake を commit 後ヘルパへ集約する", async () => {
  const source = await readFile(
    new URL("./wakeStaticRebuildQueueAfterCommit.ts", import.meta.url),
    "utf8",
  );
  const mutate = await readFile(
    new URL("../audit/mutate.ts", import.meta.url),
    "utf8",
  );
  const enqueue = await readFile(
    new URL("../staticRebuild/enqueue.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /sendQueueWakeBestEffort/);
  assert.match(source, /static_rebuild_available/);
  assert.match(mutate, /staticRebuildWakeSource/);
  assert.match(mutate, /wakeStaticRebuildQueueAfterCommit/);
  assert.match(enqueue, /wakeAfterSuccessfulEnqueue/);
  assert.match(enqueue, /sentKinds/);
});

test("producer: dispatch 有効時は static rebuild wake を送れる", async () => {
  let sendCalls = 0;
  const sent = await sendWorkerQueueWakeBestEffort({
    queue: {
      async send() {
        sendCalls += 1;
      },
    },
    kind: "static_rebuild_available",
    source: "web",
    envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
  });
  assert.equal(sent, true);
  assert.equal(sendCalls, 1);
});

test("producer: Queue送信失敗でも例外を投げない", async () => {
  let failureRecorded = false;
  const sent = await sendWorkerQueueWakeBestEffort({
    queue: {
      async send() {
        throw new Error("queue unavailable");
      },
    },
    kind: "static_rebuild_available",
    source: "web",
    envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
    kv: {
      async put() {
        await Promise.resolve();
        failureRecorded = true;
      },
    },
  });
  assert.equal(sent, false);
  assert.equal(failureRecorded, true, "Worker終了前に失敗telemetryを永続化する");
});

test("producer: wake message は業務データを含まない", () => {
  const message = createQueueWakeMessage({
    kind: "static_rebuild_available",
    source: "import",
    requestedAt: 1,
    traceId: "trace",
  });
  assert.deepEqual(Object.keys(message).sort(), [
    "kind",
    "requested_at",
    "source",
    "trace_id",
    "version",
  ]);
});
