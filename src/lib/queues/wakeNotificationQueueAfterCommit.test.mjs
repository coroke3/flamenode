import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createQueueWakeMessage,
  sendWorkerQueueWakeBestEffort,
} from "../../../workers/shared/queueWake.ts";

test("producer helper: notification wake を commit 後ヘルパへ集約する", async () => {
  const source = await readFile(
    new URL("./wakeNotificationQueueAfterCommit.ts", import.meta.url),
    "utf8",
  );
  const mutate = await readFile(
    new URL("../audit/mutate.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /sendQueueWakeBestEffort/);
  assert.match(source, /notification_available/);
  assert.match(mutate, /notificationWakeSource/);
  assert.match(mutate, /wakeNotificationQueueAfterCommit/);
});

test("producer: sentKinds 共有時は同一 kind を1回だけ送る", async () => {
  let sendCalls = 0;
  const queue = {
    async send() {
      sendCalls += 1;
    },
  };
  const sentKinds = new Set();

  const first = await sendWorkerQueueWakeBestEffort({
    queue,
    kind: "notification_available",
    source: "web",
    envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
    sentKinds,
  });
  assert.equal(first, true);
  assert.equal(sendCalls, 1);

  const duplicate = await sendWorkerQueueWakeBestEffort({
    queue,
    kind: "notification_available",
    source: "web",
    envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
    sentKinds,
  });
  assert.equal(duplicate, false);
  assert.equal(sendCalls, 1);
});

test("producer: Queue送信失敗でも例外を投げない", async () => {
  const sent = await sendWorkerQueueWakeBestEffort({
    queue: {
      async send() {
        throw new Error("queue unavailable");
      },
    },
    kind: "notification_available",
    source: "web",
    envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
  });
  assert.equal(sent, false);
});

test("producer: フラグ0では送信しない", async () => {
  let sendCalls = 0;
  const sent = await sendWorkerQueueWakeBestEffort({
    queue: {
      async send() {
        sendCalls += 1;
      },
    },
    kind: "notification_available",
    source: "web",
    envFlags: { QUEUE_DISPATCH_ENABLED: "0" },
  });
  assert.equal(sent, false);
  assert.equal(sendCalls, 0);
});

test("producer: wake message は業務データを含まない", () => {
  const message = createQueueWakeMessage({
    kind: "notification_available",
    source: "web",
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
