import test from "node:test";
import assert from "node:assert/strict";
import { mutateWithAudit, AuditMutationError } from "@flamenode/server-core/audit/mutate";
import {
  resetQueueWakeWarningStateForTests,
  sendQueueWakeBestEffort,
} from "@flamenode/server-core/queues/sendQueueWakeBestEffort";
import { resetQueueWakeFailureRecordStateForTests } from "@flamenode/server-core/queues/wakeFailureRecord";

const enabled = { QUEUE_DISPATCH_ENABLED: "1" };

function makeHost({ env, waitUntil = null, kv = null } = {}) {
  return {
    readEnv: () => {
      if (env instanceof Error) throw env;
      return env ?? null;
    },
    readWaitUntil: () => waitUntil,
    readKv: () => kv,
  };
}

test.beforeEach(() => {
  resetQueueWakeWarningStateForTests();
  resetQueueWakeFailureRecordStateForTests();
});

test("wake sends through the Queue binding the host exposes for the kind", async () => {
  const sent = [];
  const host = makeHost({
    env: { ...enabled, NOTIFICATION_WAKE_QUEUE: { send: async (message) => sent.push(message) } },
  });
  const result = await sendQueueWakeBestEffort(
    { kind: "notification_available", source: "web" },
    host,
  );
  assert.deepEqual(result, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "notification_available");
});

test("wake is skipped when the host flags dispatch off or has no env", async () => {
  const off = await sendQueueWakeBestEffort(
    { kind: "notification_available", source: "web" },
    makeHost({ env: { QUEUE_DISPATCH_ENABLED: "0" } }),
  );
  assert.deepEqual(off, { sent: false, reason: "dispatch_disabled" });
  const noEnv = await sendQueueWakeBestEffort(
    { kind: "notification_available", source: "web" },
    makeHost({ env: new Error("no binding context") }),
  );
  assert.deepEqual(noEnv, { sent: false, reason: "dispatch_disabled" });
});

test("SEC-738: poisoned host feature-flag accessor fails closed with sanitized KV telemetry", async () => {
  const secret = "SEC738_PROVIDER_SECRET_DO_NOT_LOG";
  const sent = [];
  const pending = [];
  const writes = [];
  const warned = [];
  const sentKinds = new Set();
  const poisoned = Object.defineProperty({
    ...enabled,
    NOTIFICATION_WAKE_QUEUE: { send: async (message) => { sent.push(message); } },
  }, "QUEUE_DISPATCH_ENABLED", {
    get() { throw new Error(secret); },
  });
  const host = makeHost({
    env: poisoned,
    waitUntil: (promise) => pending.push(promise),
    kv: { put: async (key, value, options) => writes.push({ key, value, options }) },
  });
  const originalWarn = console.warn;
  console.warn = (...args) => warned.push(args);
  let result;
  try {
    result = await sendQueueWakeBestEffort(
      { kind: "notification_available", source: "web", sentKinds },
      host,
    );
    await Promise.all(pending);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(result, { sent: false, reason: "feature_flags_unavailable" });
  assert.equal(sent.length, 0, "no Queue message after an unreliable flag read");
  assert.equal(sentKinds.size, 0, "failed flags must not reserve a wake kind");
  assert.equal(pending.length, 1, "failure telemetry must remain within Worker lifetime");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "queue_wake:last_failure:notification_available");
  assert.equal(JSON.parse(writes[0].value).reason, "feature_flags_unavailable");
  assert.equal(writes[0].options.expirationTtl, 7 * 24 * 60 * 60);
  assert.deepEqual(warned, [[JSON.stringify({
    service: "queue-wake", result: "feature_flags_unavailable",
    kind: "notification_available",
  })]]);
  assert.ok(!JSON.stringify({ result, warned, writes }).includes(secret),
    "provider error details must never appear in results, logs, or KV diagnostics");
});

test("SEC-738: explicitly supplied Proxy flags fail closed without touching a healthy binding", async () => {
  const secret = "SEC738_EXPLICIT_FLAGS_SECRET";
  const sends = [];
  const warned = [];
  const sentKinds = new Set();
  const host = makeHost({
    env: { ...enabled, STATIC_REBUILD_WAKE_QUEUE: { send: async (m) => sends.push(m) } },
  });
  const envFlags = new Proxy({ ...enabled }, {
    get(target, prop, receiver) {
      if (prop === "QUEUE_CONTINUATION_ENABLED") throw new TypeError(secret);
      return Reflect.get(target, prop, receiver);
    },
  });
  const originalWarn = console.warn;
  console.warn = (...args) => warned.push(args);
  let result;
  try {
    result = await sendQueueWakeBestEffort(
      { kind: "static_rebuild_available", source: "admin", envFlags, sentKinds },
      host,
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(result, { sent: false, reason: "feature_flags_unavailable" });
  assert.equal(sends.length, 0);
  assert.equal(sentKinds.size, 0);
  assert.deepEqual(warned, [
    [JSON.stringify({ service: "queue-wake", result: "feature_flags_unavailable", kind: "static_rebuild_available" })],
    [JSON.stringify({ service: "queue-wake", result: "last_failure_record_skipped", kind: "static_rebuild_available", reason: "feature_flags_unavailable" })],
  ]);
  assert.ok(!JSON.stringify({ result, warned }).includes(secret));
});

test("a missing binding records last failure in the host KV through waitUntil", async () => {
  const puts = [];
  const pending = [];
  const host = makeHost({
    env: enabled,
    kv: { put: async (key, value, options) => puts.push({ key, value, options }) },
    waitUntil: (promise) => pending.push(promise),
  });
  const result = await sendQueueWakeBestEffort(
    { kind: "static_rebuild_available", source: "admin" },
    host,
  );
  await Promise.all(pending);
  assert.deepEqual(result, { sent: false, reason: "binding_missing" });
  assert.equal(pending.length, 1);
  assert.equal(puts[0].key, "queue_wake:last_failure:static_rebuild_available");
});

test("a send failure without waitUntil is awaited and reported", async () => {
  const host = makeHost({
    env: { ...enabled, STATIC_REBUILD_WAKE_QUEUE: { send: async () => { throw new Error("down"); } } },
  });
  const result = await sendQueueWakeBestEffort(
    { kind: "static_rebuild_available", source: "admin" },
    host,
  );
  assert.deepEqual(result, { sent: false, reason: "send_failed" });
});

test("mutateWithAudit rejects a wake source without a host loader before touching D1", async () => {
  const db = new Proxy({}, { get() { throw new Error("D1 must not be touched"); } });
  await assert.rejects(
    mutateWithAudit(db, {
      mutationStatements: [{}],
      expectedMutationChanges: 1,
      audits: [{ table_name: "events", target_id: "e", operation: "UPDATE", actor_user_id: "u" }],
      staticRebuildWakeSource: "admin",
    }),
    (error) => error instanceof AuditMutationError && /host loader/.test(error.message),
  );
});


async function captureQueueWakeWarnings(run) {
  const before = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    return { value: await run(), warnings };
  } finally {
    console.warn = before;
  }
}

test("SEC-742: synchronous provider send throw uses fixed-only diagnostic without exposing Error.name/cause", async () => {
  const secret = "SEC742_SYNC_PROVIDER_SECRET";
  const providerError = Object.assign(new Error("message:" + secret, {
    cause: new Error("cause:" + secret),
  }), { name: secret });
  const sentKinds = new Set();
  const { value, warnings } = await captureQueueWakeWarnings(() =>
    sendQueueWakeBestEffort({
      kind: "notification_available",
      source: "web",
      sentKinds,
      queue: { send() { throw providerError; } },
    }, makeHost({ env: enabled })),
  );
  assert.deepEqual(value, { sent: false, reason: "send_failed" });
  assert.equal(sentKinds.size, 0);
  assert.deepEqual(warnings.map(([entry]) => JSON.parse(entry)), [
    { service: "queue-wake", result: "send_failed", kind: "notification_available" },
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "notification_available", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(warnings).includes(secret));
});

test("SEC-742: async provider rejection stays in waitUntil lifetime and releases duplicate kind without leaking Error.name", async () => {
  const secret = "SEC742_ASYNC_PROVIDER_SECRET";
  const providerError = Object.assign(new Error("message:" + secret, {
    cause: new Error("cause:" + secret),
  }), { name: secret });
  const pending = [];
  const sentKinds = new Set();
  const { value, warnings } = await captureQueueWakeWarnings(async () => {
    const result = await sendQueueWakeBestEffort({
      kind: "static_rebuild_available",
      source: "admin",
      sentKinds,
      queue: { async send() { throw providerError; } },
    }, makeHost({
      env: enabled,
      waitUntil: (promise) => pending.push(promise),
    }));
    assert.deepEqual(result, { sent: true, reason: "async_pending" });
    assert.equal(pending.length, 1);
    await Promise.all(pending);
    return result;
  });
  assert.deepEqual(value, { sent: true, reason: "async_pending" });
  assert.equal(sentKinds.size, 0, "failed wake must release the preflight marker");
  assert.deepEqual(warnings.map(([entry]) => JSON.parse(entry)), [
    { service: "queue-wake", result: "send_failed", kind: "static_rebuild_available" },
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "static_rebuild_available", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(warnings).includes(secret));
});

test("SEC-742: poisoned Error.name accessor cannot reject best-effort send path", async () => {
  const secret = "SEC742_THROWING_NAME_GETTER";
  const providerError = new Error("message:" + secret, { cause: new Error(secret) });
  Object.defineProperty(providerError, "name", {
    get() { throw new Error("name-getter:" + secret); },
  });
  const { value, warnings } = await captureQueueWakeWarnings(() =>
    sendQueueWakeBestEffort({
      kind: "youtube_sync_pending",
      source: "sync",
      queue: { send() { return Promise.reject(providerError); } },
    }, makeHost({ env: enabled })),
  );
  assert.deepEqual(value, { sent: false, reason: "send_failed" });
  assert.deepEqual(warnings.map(([entry]) => JSON.parse(entry)), [
    { service: "queue-wake", result: "send_failed", kind: "youtube_sync_pending" },
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "youtube_sync_pending", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(warnings).includes(secret));
});

test("SEC-738: throwing console.warn sink cannot escape poisoned feature-flag fail-closed path", async () => {
  const sent = [];
  const pending = [];
  const writes = [];
  const sentKinds = new Set();
  const poisoned = Object.defineProperty({
    ...enabled,
    NOTIFICATION_WAKE_QUEUE: { send: async (message) => { sent.push(message); } },
  }, "QUEUE_DISPATCH_ENABLED", {
    get() { throw new Error("flag-getter-boom"); },
  });
  const host = makeHost({
    env: poisoned,
    waitUntil: (promise) => pending.push(promise),
    kv: { put: async (key, value, options) => writes.push({ key, value, options }) },
  });
  const originalWarn = console.warn;
  console.warn = () => { throw new Error("sink unavailable"); };
  let result;
  try {
    result = await sendQueueWakeBestEffort(
      { kind: "notification_available", source: "web", sentKinds },
      host,
    );
    await Promise.all(pending);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(result, { sent: false, reason: "feature_flags_unavailable" });
  assert.equal(sent.length, 0);
  assert.equal(sentKinds.size, 0);
  assert.equal(pending.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "queue_wake:last_failure:notification_available");
  assert.equal(JSON.parse(writes[0].value).reason, "feature_flags_unavailable");
});

test("SEC-742: throwing console.warn sink preserves sentKinds cleanup and KV failure telemetry on rejecting send", async () => {
  const pending = [];
  const writes = [];
  const sentKinds = new Set();
  const host = makeHost({
    env: enabled,
    waitUntil: (promise) => pending.push(promise),
    kv: { put: async (key, value, options) => writes.push({ key, value, options }) },
  });
  const originalWarn = console.warn;
  console.warn = () => { throw new Error("sink unavailable"); };
  let result;
  try {
    result = await sendQueueWakeBestEffort({
      kind: "static_rebuild_available",
      source: "admin",
      sentKinds,
      queue: { async send() { throw new Error("queue down"); } },
    }, host);
    await Promise.all(pending);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(result, { sent: true, reason: "async_pending" });
  assert.equal(pending.length, 1);
  assert.equal(sentKinds.size, 0, "waitUntil trackedPromise must still clean up sentKinds");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "queue_wake:last_failure:static_rebuild_available");
  assert.equal(JSON.parse(writes[0].value).reason, "send_failed");
});
