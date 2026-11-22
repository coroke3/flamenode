import test from "node:test";
import assert from "node:assert/strict";
import {
  sendQueueWakeBestEffort,
  resetQueueWakeWarningStateForTests,
} from "@flamenode/server-core/queues/sendQueueWakeBestEffort";
import {
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  resetQueueWakeFailureRecordStateForTests,
} from "@flamenode/server-core/queues/wakeFailureRecordCore";

import { sendWorkerQueueWakeBestEffort } from "../../../workers/shared/queueWake.ts";
import { runPostCommitBestEffort } from "@flamenode/server-core/audit/postCommit";

// SEC-749 integration-only tests: exercise the actual combination of merged
// SEC-738/742 (#739) and SEC-740 (#741), not either helper in isolation.
// All provider, KV and logger failures are synthetic; no D1/Queue is accessed.
async function withThrowingLogger(action) {
  const original = console.warn;
  const attempted = [];
  console.warn = (...args) => {
    attempted.push(args);
    throw new Error("SEC749_LOG_SINK_UNAVAILABLE");
  };
  try {
    return { result: await action(), attempted };
  } finally {
    console.warn = original;
  }
}

test.beforeEach(() => {
  resetQueueWakeWarningStateForTests();
  resetQueueWakeFailureRecordStateForTests();
});

test("SEC-749: poisoned flags + poisoned KV getter + logger all fail soft together", async () => {
  const providerSecret = "SEC749_FLAG_AND_KV_PROVIDER_SECRET";
  let queueSends = 0;
  let kvGetterReads = 0;
  const sentKinds = new Set();
  const flags = Object.defineProperty({ QUEUE_CONTINUATION_ENABLED: "1" },
    "QUEUE_DISPATCH_ENABLED", {
      get() { throw new Error(providerSecret); },
    });
  const kv = Object.defineProperty({}, "put", {
    get() {
      kvGetterReads += 1;
      throw Object.assign(new Error(providerSecret), { name: providerSecret });
    },
  });
  const host = {
    readEnv: () => flags,
    readKv: () => kv,
    readWaitUntil: () => null,
  };

  const { result, attempted } = await withThrowingLogger(() =>
    sendQueueWakeBestEffort({
      kind: "notification_available",
      source: "web",
      queue: { async send() { queueSends += 1; } },
      sentKinds,
    }, host));

  assert.deepEqual(result, { sent: false, reason: "feature_flags_unavailable" });
  assert.equal(queueSends, 0, "poisoned flags cannot send a wake");
  assert.equal(kvGetterReads, 1, "diagnostic KV getter probed once");
  assert.equal(sentKinds.size, 0, "no duplicate-suppression marker is reserved");
  assert.deepEqual(attempted.map(([json]) => JSON.parse(json)), [
    { service: "queue-wake", result: "feature_flags_unavailable", kind: "notification_available" },
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "notification_available", reason: "feature_flags_unavailable" },
  ]);
  assert.ok(!JSON.stringify(attempted).includes(providerSecret));
});

test("SEC-749: rejected Queue and KV + throwing logger settle waitUntil and release sentKinds", async () => {
  const providerSecret = "SEC749_QUEUE_AND_KV_PROVIDER_SECRET";
  const providerError = new Error(providerSecret, { cause: new Error(providerSecret) });
  Object.defineProperty(providerError, "name", {
    get() { throw new Error("SEC749_NAME_GETTER_SECRET"); },
  });
  const pending = [];
  const sentKinds = new Set();
  let sendCalls = 0;
  let kvPutCalls = 0;
  const kv = {
    async put(key, value, options) {
      assert.equal(this, kv, "preserve KV binding method receiver");
      assert.equal(key, "queue_wake:last_failure:static_rebuild_available");
      assert.equal(JSON.parse(value).reason, "send_failed");
      assert.deepEqual(options, { expirationTtl: QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS });
      kvPutCalls += 1;
      throw providerError;
    },
  };
  const host = {
    readEnv: () => ({ QUEUE_DISPATCH_ENABLED: "1" }),
    readKv: () => kv,
    readWaitUntil: () => (promise) => pending.push(promise),
  };

  const { result, attempted } = await withThrowingLogger(async () => {
    const value = await sendQueueWakeBestEffort({
      kind: "static_rebuild_available",
      source: "web",
      sentKinds,
      queue: { async send() { sendCalls += 1; throw providerError; } },
    }, host);
    assert.deepEqual(value, { sent: true, reason: "async_pending" });
    assert.equal(pending.length, 1, "the recovery Promise is retained by waitUntil");
    await assert.doesNotReject(Promise.all(pending));
    return value;
  });

  assert.deepEqual(result, { sent: true, reason: "async_pending" });
  assert.equal(sendCalls, 1);
  assert.equal(kvPutCalls, 1);
  assert.equal(sentKinds.size, 0, "failed Queue send releases the reserved kind");
  assert.deepEqual(attempted.map(([json]) => JSON.parse(json)), [
    { service: "queue-wake", result: "send_failed", kind: "static_rebuild_available" },
    { service: "queue-wake", result: "last_failure_record_failed", kind: "static_rebuild_available", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(attempted).includes(providerSecret));
  assert.ok(!JSON.stringify(attempted).includes("SEC749_NAME_GETTER_SECRET"));
});

test("SEC-749: combined guards preserve a healthy post-commit wake", async () => {
  const sentKinds = new Set();
  const sent = [];
  const host = {
    readEnv: () => ({ QUEUE_DISPATCH_ENABLED: "1" }),
    readKv: () => { throw new Error("unexpected KV read"); },
    readWaitUntil: () => null,
  };
  const { result, attempted } = await withThrowingLogger(() =>
    sendQueueWakeBestEffort({
      kind: "youtube_sync_pending",
      source: "web",
      sentKinds,
      queue: { async send(message) { sent.push(message); } },
    }, host));
  assert.deepEqual(result, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "youtube_sync_pending");
  assert.deepEqual([...sentKinds], ["youtube_sync_pending"]);
  assert.deepEqual(attempted, [], "healthy sends should not invoke diagnostics");
});

test("SEC-749: worker and core compound diagnostic faults cannot interrupt postcommit work", async () => {
  // Exercise the actual merged Worker #744, Core #739/#741, and postcommit
  // continuation #745 in one call sequence. No real Queue, D1 or KV is used.
  const providerSecret = "SEC749_CROSS_LAYER_PROVIDER_SECRET";
  const providerError = new Error(providerSecret, { cause: new Error(providerSecret) });
  Object.defineProperty(providerError, "name", {
    get() { throw new Error("SEC749_CROSS_LAYER_NAME_ACCESSOR"); },
  });
  const flags = new Proxy({}, {
    get() { throw providerError; },
  });
  let kvGetterReads = 0;
  const kv = Object.defineProperty({}, "put", {
    get() {
      kvGetterReads += 1;
      throw providerError;
    },
  });
  const sentKinds = new Set();
  const executed = [];
  let sends = 0;
  const queue = { async send() { sends += 1; } };

  const { result: warnings, attempted } = await withThrowingLogger(() =>
    runPostCommitBestEffort(
      { flow: "sec749_worker_core_integration", traceId: "sec749_combo" },
      [
        {
          name: "worker_continuation",
          run: async () => {
            const outcome = await sendWorkerQueueWakeBestEffort({
              queue,
              kind: "youtube_playlist_sync",
              source: "continuation",
              envFlags: flags,
              kv,
              sentKinds,
            });
            assert.equal(outcome, false);
            executed.push("worker_continuation");
          },
        },
        {
          name: "core_wake",
          run: async () => {
            const outcome = await sendQueueWakeBestEffort({
              queue,
              kind: "notification_available",
              source: "web",
              sentKinds,
            }, {
              readEnv: () => flags,
              readKv: () => kv,
              readWaitUntil: () => null,
            });
            assert.deepEqual(outcome, { sent: false, reason: "feature_flags_unavailable" });
            executed.push("core_wake");
          },
        },
        {
          name: "revalidate_after_failed_wakes",
          run: async () => { executed.push("revalidate_after_failed_wakes"); },
        },
      ],
    ));

  assert.deepEqual(warnings, [], "poisoned diagnostics must not become task failures");
  assert.deepEqual(executed, [
    "worker_continuation",
    "core_wake",
    "revalidate_after_failed_wakes",
  ], "subsequent postcommit work must run after both failure paths");
  assert.equal(sends, 0, "neither poisoned feature flag path may send");
  assert.equal(kvGetterReads, 2, "both layers exercise the real poisoned KV getter");
  assert.equal(sentKinds.size, 0, "no failure may reserve a Queue kind");

  assert.deepEqual(attempted.map(([json]) => JSON.parse(json)), [
    { service: "queue-wake-worker", result: "feature_flags_unavailable", kind: "youtube_playlist_sync" },
    { service: "queue-wake-worker", result: "last_failure_record_skipped", kind: "youtube_playlist_sync", reason: "feature_flags_unavailable" },
    { service: "queue-wake", result: "feature_flags_unavailable", kind: "notification_available" },
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "notification_available", reason: "feature_flags_unavailable" },
  ]);
  assert.ok(!JSON.stringify({ attempted, warnings }).includes(providerSecret));
  assert.ok(!JSON.stringify({ attempted, warnings }).includes("SEC749_CROSS_LAYER_NAME_ACCESSOR"));
});
