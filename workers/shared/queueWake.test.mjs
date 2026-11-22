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
    { service: "queue-wake-worker", result: "failure_record_unavailable", kind: "youtube_sync_pending" },
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
    { service: "queue-wake-worker", result: "failure_record_unavailable", kind: "static_rebuild_available" },
  ]);
  assert.ok(!JSON.stringify(values).includes(secret));
});
