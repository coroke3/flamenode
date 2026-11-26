import assert from "node:assert/strict";
import { test } from "node:test";
import { logStuckPublicVisibilityFenceCandidate } from "./visibilityCompensation.ts";

test("failed visibility compensation emits a structured stuck-fence candidate", () => {
  const originalWarn = console.warn;
  const rows = [];
  console.warn = (value) => rows.push(String(value));
  try {
    logStuckPublicVisibilityFenceCandidate({
      flow: "fixture",
      entityType: "x_user",
      entityId: "creator",
      fenceToken: "vf_fixture",
      error: new Error("r2_cas_failed"),
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0]), {
    service: "visibility_fence",
    flow: "fixture",
    phase: "stuck_fence_candidate",
    entity_type: "x_user",
    entity_id: "creator",
    fence_token: "vf_fixture",
    attempt_count: 3,
    error_code: "r2_cas_failed",
  });
});


test("SEC-789: poisoned provider messages produce fixed code without getter or secret leakage", () => {
  let messageReads = 0;
  let nameReads = 0;
  const poisoned = new Error("SEC789_PRIVATE_SQL_TOKEN");
  Object.defineProperty(poisoned, "message", {
    get() {
      messageReads++;
      throw new Error("SEC789_POISONED_MESSAGE");
    },
  });
  Object.defineProperty(poisoned, "name", {
    get() {
      nameReads++;
      throw new Error("SEC789_POISONED_NAME");
    },
  });

  const errors = [poisoned, new Error("SEC789_UNREDACTED_PROVIDER_SQL")];
  const oldWarn = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(String(line));
  try {
    for (const error of errors) {
      logStuckPublicVisibilityFenceCandidate({
        flow: "fixture",
        entityType: "event",
        entityId: "event-1",
        fenceToken: "vf_fixture",
        error,
        attempts: 2,
      });
    }
  } finally {
    console.warn = oldWarn;
  }
  assert.equal(lines.length, 2);
  assert.equal(messageReads, 1);
  assert.equal(nameReads, 0);
  for (const line of lines) {
    const log = JSON.parse(line);
    assert.deepEqual({
      service: log.service,
      flow: log.flow,
      phase: log.phase,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      fence_token: log.fence_token,
      attempt_count: log.attempt_count,
      error_code: log.error_code,
    }, {
      service: "visibility_fence",
      flow: "fixture",
      phase: "stuck_fence_candidate",
      entity_type: "event",
      entity_id: "event-1",
      fence_token: "vf_fixture",
      attempt_count: 2,
      error_code: "visibility_compensation_failed",
    });
    assert.doesNotMatch(line, /SEC789_/);
  }
});

test("SEC-789: hostile Proxy, nonstring message and broken console.warn do not throw", () => {
  const proxy = new Proxy(new Error("SEC789_HIDDEN"), {
    getPrototypeOf() { throw new Error("SEC789_PROXY_TRAP"); },
  });
  let coercions = 0;
  const nonString = new Error("ordinary");
  Object.defineProperty(nonString, "message", {
    value: { toString() { coercions++; throw new Error("SEC789_COERCION"); } },
  });
  const oldWarn = console.warn;
  let attempts = 0;
  console.warn = () => { attempts++; throw new Error("SEC789_BROKEN_SINK"); };
  try {
    for (const error of [proxy, nonString]) {
      assert.doesNotThrow(() => logStuckPublicVisibilityFenceCandidate({
        flow: "fixture",
        entityType: "x_user",
        entityId: "creator",
        fenceToken: "vf_fixture",
        error,
      }));
    }
  } finally {
    console.warn = oldWarn;
  }
  assert.equal(coercions, 0);
  assert.equal(attempts, 2);
});

test("SEC-789: actual failed fence compensator cannot reject because diagnostic sink throws", async () => {
  const { compensatePublicVisibilityFenceOnD1Failure } = await import(
    "../../../packages/server-core/src/visibility/fenceTransition.ts"
  );
  let calls = 0;
  const log = console.warn;
  console.warn = () => { calls++; throw new Error("SEC789_POISONED_LOGGER"); };
  let r2Reads = 0;
  let r2Writes = 0;
  try {
    await assert.doesNotReject(() => compensatePublicVisibilityFenceOnD1Failure({
      db: { select() { throw new Error("SEC789_PRIVATE_D1_INFO"); } },
      entityType: "event",
      entityId: "event-1",
      fenceToken: "vf_fixture",
      flow: "fixture",
    }, {
      manifest: {
        async read() { r2Reads++; throw new Error("R2 must not be accessed"); },
        async write() { r2Writes++; throw new Error("R2 must not be modified"); },
      },
    }));
  } finally {
    console.warn = log;
  }
  assert.equal(calls, 1, "the stuck-fence diagnostic was attempted");
  assert.equal(r2Reads, 0);
  assert.equal(r2Writes, 0, "a diagnostic failure cannot remove the R2 block");
});
