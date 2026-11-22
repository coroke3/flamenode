import assert from "node:assert/strict";
import { test } from "node:test";
import { sendWorkerQueueWakeBestEffort } from "./queueWake.ts";

const enabledFlags = {
  QUEUE_DISPATCH_ENABLED: "1",
  QUEUE_CONTINUATION_ENABLED: "1",
};

test("static rebuild continuation は指定されたdelaySecondsでbackpressureする", async () => {
  let sent = null;
  const queued = await sendWorkerQueueWakeBestEffort({
    queue: {
      async send(body, options) {
        sent = { body, options };
      },
    },
    kind: "static_rebuild_available",
    source: "continuation",
    delaySeconds: 30,
    envFlags: enabledFlags,
  });

  assert.equal(queued, true);
  assert.equal(sent.body.kind, "static_rebuild_available");
  assert.deepEqual(sent.options, { delaySeconds: 30 });
});

test("invalid Queue delayはwakeを送らずfail-closedする", async () => {
  let sendCount = 0;
  const queued = await sendWorkerQueueWakeBestEffort({
    queue: {
      async send() {
        sendCount += 1;
      },
    },
    kind: "static_rebuild_available",
    source: "continuation",
    delaySeconds: 86_401,
    envFlags: enabledFlags,
  });

  assert.equal(queued, false);
  assert.equal(sendCount, 0);
});

async function collectQueueWarnings(run) {
  const original = console.warn;
  const values = [];
  console.warn = (...items) => values.push(items);
  try {
    return { result: await run(), values };
  } finally {
    console.warn = original;
  }
}

test("SEC-743: throwing Worker env flag getter fails closed, persists fixed failure code and never sends", async () => {
  const secret = "SEC743_FLAG_ACCESSOR_SECRET";
  let sends = 0;
  const writes = [];
  const envFlags = new Proxy({}, {
    get() { throw Object.assign(new Error("provider " + secret, { cause: new Error(secret) }), { name: secret }); },
  });
  const { result, values } = await collectQueueWarnings(() =>
    sendWorkerQueueWakeBestEffort({
      queue: { send: async () => { sends += 1; } },
      kind: "youtube_playlist_sync",
      source: "continuation",
      envFlags,
      kv: { put: async (key, payload) => writes.push({ key, value: JSON.parse(payload) }) },
    }),
  );
  assert.equal(result, false);
  assert.equal(sends, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "queue_wake:last_failure:youtube_playlist_sync");
  assert.equal(writes[0].value.reason, "feature_flags_unavailable");
  assert.deepEqual(values.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake-worker", result: "feature_flags_unavailable", kind: "youtube_playlist_sync" },
  ]);
  assert.ok(!JSON.stringify(values).includes(secret));
});

test("SEC-743: missing Worker Queue and poisoned diagnostic KV cannot reject recovery", async () => {
  const secret = "SEC743_KV_GETTER_SECRET";
  const kv = Object.defineProperty({}, "put", {
    get() { throw Object.assign(new Error(secret), { name: secret }); },
  });
  const { result, values } = await collectQueueWarnings(() =>
    sendWorkerQueueWakeBestEffort({
      queue: null,
      kind: "youtube_sync_pending",
      source: "recovery",
      envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
      kv,
    }),
  );
  assert.equal(result, false);
  assert.deepEqual(values.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake-worker", result: "binding_missing", kind: "youtube_sync_pending" },
    { service: "queue-wake-worker", result: "last_failure_record_skipped", kind: "youtube_sync_pending", reason: "binding_missing" },
  ]);
  assert.ok(!JSON.stringify(values).includes(secret));
});

test("SEC-743: sync Queue send throw never leaks Error.name/cause or leaves sentKinds reserved", async () => {
  const secret = "SEC743_SYNC_SEND_ERROR_NAME";
  const sentKinds = new Set();
  const writes = [];
  const error = Object.assign(new Error("provider " + secret, { cause: new Error(secret) }), { name: secret });
  const { result, values } = await collectQueueWarnings(() =>
    sendWorkerQueueWakeBestEffort({
      queue: { send: () => { throw error; } },
      kind: "notification_available",
      source: "web",
      envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
      sentKinds,
      kv: { put: async (key, payload) => writes.push({ key, value: JSON.parse(payload) }) },
    }),
  );
  assert.equal(result, false);
  assert.equal(sentKinds.size, 0, "failed wake must release the duplicate suppression marker");
  assert.deepEqual(writes.map((entry) => entry.value.reason), ["send_failed"]);
  assert.deepEqual(values.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake-worker", result: "send_failed", kind: "notification_available" },
  ]);
  assert.ok(!JSON.stringify(values).includes(secret));
});

test("SEC-743: rejected delayed Queue send with poisoned diagnostic KV remains nonthrowing", async () => {
  const secret = "SEC743_ASYNC_REJECTION_NAME";
  const error = Object.assign(new Error("provider " + secret, { cause: new Error(secret) }), { name: secret });
  let passedDelay;
  const kv = new Proxy({}, {
    get(_target, prop) {
      if (prop === "put") throw Object.assign(new Error(secret), { name: secret });
      return undefined;
    },
  });
  const sentKinds = new Set();
  const { result, values } = await collectQueueWarnings(() =>
    sendWorkerQueueWakeBestEffort({
      queue: { send: async (_msg, opts) => { passedDelay = opts?.delaySeconds; throw error; } },
      kind: "static_rebuild_available",
      source: "continuation",
      envFlags: { QUEUE_DISPATCH_ENABLED: "1", QUEUE_CONTINUATION_ENABLED: "1" },
      delaySeconds: 30,
      kv,
      sentKinds,
    }),
  );
  assert.equal(result, false);
  assert.equal(passedDelay, 30);
  assert.equal(sentKinds.size, 0);
  assert.deepEqual(values.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake-worker", result: "send_failed", kind: "static_rebuild_available" },
    { service: "queue-wake-worker", result: "last_failure_record_skipped", kind: "static_rebuild_available", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(values).includes(secret));
});

test("SEC-743/#740: rejected diagnostic KV put cannot leak provider Error.name/message/cause", async () => {
  const secret = "SEC743_REJECTED_KV_PUT_SECRET";
  const providerError = Object.assign(
    new Error("provider message " + secret, { cause: new Error("nested " + secret) }),
    { name: secret },
  );
  let puts = 0;
  const { result, values } = await collectQueueWarnings(() =>
    sendWorkerQueueWakeBestEffort({
      queue: null,
      kind: "youtube_playlist_sync",
      source: "recovery",
      envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
      kv: { async put() { puts += 1; throw providerError; } },
    }),
  );
  assert.equal(result, false, "optional failure-record write must never reject Worker recovery");
  assert.equal(puts, 1, "real KV rejection path must execute");
  assert.deepEqual(values.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake-worker", result: "binding_missing", kind: "youtube_playlist_sync" },
    { service: "queue-wake-worker", result: "last_failure_record_failed", kind: "youtube_playlist_sync", reason: "binding_missing" },
  ]);
  assert.ok(!JSON.stringify(values).includes(secret), "no nested provider detail may reach logs");
});

async function withThrowingWarnSink(run) {
  const original = console.warn;
  const attempted = [];
  console.warn = (...items) => {
    attempted.push(items);
    throw new Error("sink unavailable");
  };
  try {
    return { result: await run(), attempted };
  } finally {
    console.warn = original;
  }
}

test("SEC-743/#740: non-function diagnostic KV accessor is skipped without leaking its value", async () => {
  const secret = "SEC743_NONFUNCTION_KV_ACCESSOR_SECRET";
  const kv = Object.defineProperty({}, "put", {
    get() { return secret; },
  });
  const { result, values } = await collectQueueWarnings(() =>
    sendWorkerQueueWakeBestEffort({
      queue: null,
      kind: "notification_available",
      source: "recovery",
      envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
      kv,
    }),
  );
  assert.equal(result, false);
  assert.deepEqual(values.map(([entry]) => JSON.parse(entry)), [
    { service: "queue-wake-worker", result: "binding_missing", kind: "notification_available" },
    { service: "queue-wake-worker", result: "last_failure_record_skipped", kind: "notification_available", reason: "binding_missing" },
  ]);
  assert.ok(!JSON.stringify(values).includes(secret));
});

test("SEC-743: throwing console.warn on flags-getter failure resolves false, preserves KV/sentKinds and leaks no secrets", async () => {
  const secret = "SEC743_WARN_SINK_FLAGS_SECRET";
  let sends = 0;
  const sentKinds = new Set();
  const writes = [];
  const envFlags = new Proxy({}, {
    get() {
      throw Object.assign(new Error("provider " + secret, { cause: new Error(secret) }), { name: secret });
    },
  });
  const originalWarn = console.warn;
  const { result, attempted } = await withThrowingWarnSink(() =>
    sendWorkerQueueWakeBestEffort({
      queue: { send: async () => { sends += 1; } },
      kind: "notification_available",
      source: "continuation",
      envFlags,
      sentKinds,
      kv: { put: async (key, payload) => writes.push({ key, value: JSON.parse(payload) }) },
    }),
  );
  assert.equal(console.warn, originalWarn);
  assert.equal(result, false);
  assert.equal(sends, 0);
  assert.equal(sentKinds.size, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "queue_wake:last_failure:notification_available");
  assert.equal(writes[0].value.reason, "feature_flags_unavailable");
  assert.deepEqual(attempted.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake-worker", result: "feature_flags_unavailable", kind: "notification_available" },
  ]);
  assert.ok(!JSON.stringify(attempted).includes(secret));
});

test("SEC-743: throwing console.warn on Queue rejection and missing KV diagnostic resolves false without leaking secrets", async () => {
  const secret = "SEC743_WARN_SINK_SEND_SECRET";
  const providerError = Object.assign(
    new Error("provider " + secret, { cause: new Error("nested " + secret) }),
    { name: secret },
  );
  const sentKinds = new Set();
  const writes = [];
  let rejectedSendCalls = 0;
  let passedDelay;
  const originalWarn = console.warn;

  const { result, attempted } = await withThrowingWarnSink(async () => {
    const sendRejectMissingKv = await sendWorkerQueueWakeBestEffort({
      queue: {
        send: async (_msg, opts) => {
          rejectedSendCalls += 1;
          passedDelay = opts?.delaySeconds;
          throw providerError;
        },
      },
      kind: "youtube_sync_pending",
      source: "continuation",
      delaySeconds: 15,
      envFlags: { QUEUE_DISPATCH_ENABLED: "1", QUEUE_CONTINUATION_ENABLED: "1" },
      sentKinds,
      kv: null,
    });
    const sendRejectHealthyKv = await sendWorkerQueueWakeBestEffort({
      queue: {
        send: async () => {
          rejectedSendCalls += 1;
          throw providerError;
        },
      },
      kind: "youtube_playlist_sync",
      source: "recovery",
      envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
      sentKinds,
      kv: { put: async (key, payload) => writes.push({ key, value: JSON.parse(payload) }) },
    });
    const missingBindingMissingKv = await sendWorkerQueueWakeBestEffort({
      queue: null,
      kind: "static_rebuild_available",
      source: "recovery",
      envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
      sentKinds,
      kv: null,
    });
    return { sendRejectMissingKv, sendRejectHealthyKv, missingBindingMissingKv };
  });

  assert.equal(console.warn, originalWarn);
  assert.equal(result.sendRejectMissingKv, false);
  assert.equal(result.sendRejectHealthyKv, false);
  assert.equal(result.missingBindingMissingKv, false);
  assert.equal(rejectedSendCalls, 2);
  assert.equal(passedDelay, 15);
  assert.equal(sentKinds.size, 0, "failed wakes must release sentKinds markers");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "queue_wake:last_failure:youtube_playlist_sync");
  assert.equal(writes[0].value.reason, "send_failed");
  assert.deepEqual(attempted.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake-worker", result: "send_failed", kind: "youtube_sync_pending" },
    { service: "queue-wake-worker", result: "last_failure_record_skipped", kind: "youtube_sync_pending", reason: "send_failed" },
    { service: "queue-wake-worker", result: "send_failed", kind: "youtube_playlist_sync" },
    { service: "queue-wake-worker", result: "binding_missing", kind: "static_rebuild_available" },
    { service: "queue-wake-worker", result: "last_failure_record_skipped", kind: "static_rebuild_available", reason: "binding_missing" },
  ]);
  assert.ok(!JSON.stringify(attempted).includes(secret));
});
