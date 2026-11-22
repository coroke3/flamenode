import test from "node:test";
import assert from "node:assert/strict";
import {
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  recordQueueWakeFailureBestEffortCore,
  resetQueueWakeFailureRecordStateForTests,
} from "@flamenode/server-core/queues/wakeFailureRecordCore";
import { recordQueueWakeFailureBestEffort } from "@flamenode/server-core/queues/wakeFailureRecord";

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

test.beforeEach(() => resetQueueWakeFailureRecordStateForTests());

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
