import test from "node:test";
import assert from "node:assert/strict";
import {
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  recordQueueWakeFailureBestEffortCore,
  resetQueueWakeFailureRecordStateForTests,
} from "@flamenode/server-core/queues/wakeFailureRecordCore";
import { recordQueueWakeFailureBestEffort } from "@flamenode/server-core/queues/wakeFailureRecord";
import { sendQueueWakeBestEffort, resetQueueWakeWarningStateForTests } from "@flamenode/server-core/queues/sendQueueWakeBestEffort";

async function captureWarnings(run) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return warnings;
}

async function withThrowingWarnSink(run) {
  const original = console.warn;
  const attemptedWarnings = [];
  console.warn = (...args) => {
    attemptedWarnings.push(args);
    throw new Error("sink unavailable");
  };
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return attemptedWarnings;
}

test.beforeEach(() => {
  resetQueueWakeFailureRecordStateForTests();
  resetQueueWakeWarningStateForTests();
});

test("SEC-740: poisoned KV put getter is a skipped diagnostic, never a rejected business wake", async () => {
  const secret = "SEC740_PROVIDER_ACCESSOR_SECRET";
  let reads = 0;
  const kv = Object.defineProperty({}, "put", {
    get() {
      reads += 1;
      throw new Error(secret);
    },
  });
  const warnings = await captureWarnings(async () => {
    await recordQueueWakeFailureBestEffortCore("queue-wake", {
      kind: "notification_available",
      reason: "binding_missing",
      kv,
    });
    await recordQueueWakeFailureBestEffort({
      kind: "static_rebuild_available",
      reason: "send_failed",
    }, {
      readEnv: () => null,
      readWaitUntil: () => null,
      readKv: () => kv,
    });
  });
  assert.equal(reads, 2);
  assert.deepEqual(warnings.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "notification_available", reason: "binding_missing" },
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "static_rebuild_available", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(warnings).includes(secret), "provider getter/cause must not enter telemetry");
});

test("SEC-740: Proxy accessor and malicious rejection Error.name never escape fixed diagnostics", async () => {
  const secret = "SEC740_LEAKED_PROVIDER_ERROR_NAME";
  const poisoned = new Proxy({}, {
    get(_target, prop) {
      if (prop === "put") throw Object.assign(new Error("nested:" + secret), { name: secret });
      return undefined;
    },
  });
  const rejection = new Error("provider failed: " + secret, { cause: new Error(secret) });
  rejection.name = secret;
  const failing = { put: async () => { throw rejection; } };
  const warnings = await captureWarnings(async () => {
    await recordQueueWakeFailureBestEffortCore("queue-wake", {
      kind: "notification_available", reason: "binding_missing", kv: poisoned,
    });
    await recordQueueWakeFailureBestEffortCore("queue-wake", {
      kind: "static_rebuild_available", reason: "send_failed", kv: failing,
    });
  });
  assert.deepEqual(warnings.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "notification_available", reason: "binding_missing" },
    { service: "queue-wake", result: "last_failure_record_failed", kind: "static_rebuild_available", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(warnings).includes(secret), "Error.name, Error.message and nested cause are untrusted");
});

test("SEC-740: legitimate getter is read exactly once, bound receiver works, TTL and coalescing stay intact", async () => {
  const writes = [];
  let accesses = 0;
  const kv = {
    get put() {
      accesses += 1;
      return async function(key, value, options) {
        assert.equal(this, kv, "KV methods may depend on their binding receiver");
        writes.push({ key, value: JSON.parse(value), options });
      };
    },
  };
  const warnings = await captureWarnings(async () => {
    for (let i = 0; i < 2; i += 1) {
      await recordQueueWakeFailureBestEffortCore("queue-wake", {
        kind: "notification_available", reason: "binding_missing", kv,
      });
    }
  });
  assert.deepEqual(warnings, []);
  assert.equal(accesses, 2, "one getter read per invocation, including a coalesced attempt");
  assert.equal(writes.length, 1, "same-key, same-reason KV writes are coalesced");
  assert.equal(writes[0].key, "queue_wake:last_failure:notification_available");
  assert.equal(writes[0].value.reason, "binding_missing");
  assert.deepEqual(writes[0].options, { expirationTtl: QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS });
});

test("SEC-740: real missing-binding and failed-send wake never reject on broken diagnostic KV", async () => {
  let getterCalls = 0;
  const poisonedKv = Object.defineProperty({}, "put", {
    get() {
      getterCalls += 1;
      throw new Error("DIAGNOSTIC_KV_GETTER_SECRET");
    },
  });
  const readKv = () => poisonedKv;
  const warnings = await captureWarnings(async () => {
    const missing = await sendQueueWakeBestEffort(
      { kind: "notification_available", source: "web" },
      {
        readEnv: () => ({ QUEUE_DISPATCH_ENABLED: "1" }),
        readWaitUntil: () => null,
        readKv,
      },
    );
    assert.deepEqual(missing, { sent: false, reason: "binding_missing" });

    const failed = await sendQueueWakeBestEffort(
      { kind: "static_rebuild_available", source: "web" },
      {
        readEnv: () => ({
          QUEUE_DISPATCH_ENABLED: "1",
          STATIC_REBUILD_WAKE_QUEUE: { send: async () => { throw new Error("queue is down"); } },
        }),
        readWaitUntil: () => null,
        readKv,
      },
    );
    assert.deepEqual(failed, { sent: false, reason: "send_failed" });
  });
  const events = warnings.map(([value]) => JSON.parse(value));
  assert.equal(getterCalls, 2, "one diagnostic KV read per failed wake");
  assert.equal(events.filter((event) => event.result === "last_failure_record_skipped").length, 2);
  assert.ok(events.some((event) => event.result === "binding_missing"));
  assert.ok(events.some((event) => event.result === "send_failed"));
  assert.ok(!JSON.stringify(warnings).includes("DIAGNOSTIC_KV_GETTER_SECRET"));
});

test("SEC-740: throwing console.warn on missing or poisoned kv.put resolves cleanly and preserves TTL/coalescing", async () => {
  const secret = "SEC740_SINK_POISONED_GETTER_SECRET";
  const poisonedKv = Object.defineProperty({}, "put", {
    get() {
      throw Object.assign(new Error("getter:" + secret, { cause: new Error(secret) }), { name: secret });
    },
  });
  const writes = [];
  const healthyKv = {
    async put(key, value, options) {
      assert.equal(this, healthyKv);
      writes.push({ key, value: JSON.parse(value), options });
    },
  };

  const originalWarn = console.warn;
  const attemptedWarnings = await withThrowingWarnSink(async () => {
    await assert.doesNotReject(() =>
      recordQueueWakeFailureBestEffortCore("queue-wake", {
        kind: "notification_available",
        reason: "binding_missing",
        kv: null,
      })
    );
    await assert.doesNotReject(() =>
      recordQueueWakeFailureBestEffortCore("queue-wake", {
        kind: "static_rebuild_available",
        reason: "send_failed",
        kv: poisonedKv,
      })
    );
    for (let i = 0; i < 2; i += 1) {
      await assert.doesNotReject(() =>
        recordQueueWakeFailureBestEffortCore("queue-wake", {
          kind: "notification_available",
          reason: "binding_missing",
          kv: healthyKv,
        })
      );
    }
  });

  assert.equal(console.warn, originalWarn);
  assert.deepEqual(attemptedWarnings.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "notification_available", reason: "binding_missing" },
    { service: "queue-wake", result: "last_failure_record_skipped", kind: "static_rebuild_available", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(attemptedWarnings).includes(secret));
  assert.equal(writes.length, 1, "same-key, same-reason KV writes remain coalesced");
  assert.equal(writes[0].key, "queue_wake:last_failure:notification_available");
  assert.equal(writes[0].value.reason, "binding_missing");
  assert.deepEqual(writes[0].options, { expirationTtl: QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS });
});

test("SEC-740: throwing console.warn on rejecting kv.put resolves cleanly, omits provider error fields, and keeps TTL/coalescing", async () => {
  const secret = "SEC740_SINK_REJECT_PROVIDER_SECRET";
  let rejectCalls = 0;
  const rejection = Object.assign(new Error("put failed: " + secret, { cause: new Error(secret) }), {
    name: secret,
  });
  const failingKv = {
    async put() {
      rejectCalls += 1;
      throw rejection;
    },
  };
  const writes = [];
  const healthyKv = {
    async put(key, value, options) {
      assert.equal(this, healthyKv);
      writes.push({ key, value: JSON.parse(value), options });
    },
  };

  const originalWarn = console.warn;
  const attemptedWarnings = await withThrowingWarnSink(async () => {
    for (let i = 0; i < 2; i += 1) {
      await assert.doesNotReject(() =>
        recordQueueWakeFailureBestEffortCore("queue-wake", {
          kind: "notification_available",
          reason: "send_failed",
          kv: failingKv,
        })
      );
    }
    for (let i = 0; i < 2; i += 1) {
      await assert.doesNotReject(() =>
        recordQueueWakeFailureBestEffortCore("queue-wake", {
          kind: "static_rebuild_available",
          reason: "binding_missing",
          kv: healthyKv,
        })
      );
    }
  });

  assert.equal(console.warn, originalWarn);
  assert.equal(rejectCalls, 1, "rejecting KV failure attempt is still coalesced");
  assert.deepEqual(attemptedWarnings.map(([value]) => JSON.parse(value)), [
    { service: "queue-wake", result: "last_failure_record_failed", kind: "notification_available", reason: "send_failed" },
  ]);
  assert.ok(!JSON.stringify(attemptedWarnings).includes(secret));
  assert.equal(writes.length, 1, "healthy KV write remains coalesced");
  assert.equal(writes[0].key, "queue_wake:last_failure:static_rebuild_available");
  assert.equal(writes[0].value.reason, "binding_missing");
  assert.deepEqual(writes[0].options, { expirationTtl: QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS });
});
