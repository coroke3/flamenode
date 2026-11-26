import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// CURRENT imports Next/server-only. Exercise the actual source-defined
// flush and retry functions with isolated fake KV, not a reimplemented model.
const source = await readFile(new URL("./degradedCircuitBreaker.ts", import.meta.url), "utf8");
const start = source.indexOf("async function flushMissCount(");
const end = source.indexOf("/** degraded D1", start);
assert.ok(start >= 0 && end > start, "extract the committed KV flush path");
const isolatedFunctions = stripTypeScriptTypes(source.slice(start, end), { mode: "strip" });

function createFlushHarness({ brokenWarning = false, brokenMarker = false } = {}) {
  const pending = { bucket: 1, observed: 1, pending: 1, lastFlushAt: Number.NEGATIVE_INFINITY };
  const events = [];
  const warnings = [];
  const kv = {
    async get(key) {
      events.push(["get", key]);
      return null;
    },
    async delete(key) {
      events.push(["delete", key]);
    },
  };
  const context = {
    console: {
      warn(message) {
        const event = JSON.parse(message);
        warnings.push(event);
        if (brokenWarning) throw new Error("SEC796_LOG_SINK_UNAVAILABLE");
      },
    },
    missAccumulator: pending,
    missFlushInFlight: false,
    localCircuitState: { open: false, openUntil: 0 },
    degradedCircuitOpenKey: () => "open-marker",
    degradedCircuitHitStreakKey: () => "hit-streak",
    markCircuitOpen: () => {},
    markCircuitClosed: () => {},
    async persistMissCounter(_kv, bucket, count) {
      events.push(["persist", bucket, count]);
      return 5;
    },
    async putOpenMarkerIfNeeded(_kv, _now) {
      events.push(["open"]);
      if (brokenMarker) throw new Error("SEC796_ACTUAL_KV_FAILURE");
    },
    shouldOpenDegradedCircuit: (count) => count >= 5,
    DEGRADED_CIRCUIT_MISS_THRESHOLD: 5,
    DEGRADED_CIRCUIT_MISS_WINDOW_SEC: 60,
    DEGRADED_CIRCUIT_MISS_LOCAL_FLUSH_MS: 1000,
  };
  const flushPendingMissesIfReady = runInNewContext(
    isolatedFunctions + "\nflushPendingMissesIfReady",
    context,
  );
  return { flushPendingMissesIfReady, context, kv, pending, events, warnings };
}

test("SEC-796: logger throw after KV commit does not re-credit persisted misses", async () => {
  const fixture = createFlushHarness({ brokenWarning: true });
  assert.equal(await fixture.flushPendingMissesIfReady(fixture.kv, 60_000), true);
  assert.equal(fixture.pending.pending, 0, "committed misses must not be retried");
  assert.equal(fixture.context.missFlushInFlight, false);
  assert.deepEqual(fixture.events, [
    ["get", "open-marker"],
    ["persist", 1, 1],
    ["open"],
    ["delete", "hit-streak"],
  ]);
  assert.equal(fixture.warnings.length, 1, "diagnostic was attempted, never required");
  assert.equal(await fixture.flushPendingMissesIfReady(fixture.kv, 61_000), false);
  assert.equal(fixture.events.filter(([kind]) => kind === "persist").length, 1);
});

test("SEC-796: genuine KV marker failure still retains pending for retry", async () => {
  const fixture = createFlushHarness({ brokenMarker: true });
  assert.equal(await fixture.flushPendingMissesIfReady(fixture.kv, 60_000), true);
  assert.equal(fixture.pending.pending, 1, "real KV failure is not silently accepted");
  assert.equal(fixture.context.missFlushInFlight, false);
  assert.equal(fixture.events.some(([kind]) => kind === "delete"), false);
  assert.deepEqual(fixture.warnings, [], "no OPEN diagnostic before KV success");
});

test("SEC-796: healthy OPEN diagnostic preserves fixed fields and accounting", async () => {
  const fixture = createFlushHarness();
  assert.equal(await fixture.flushPendingMissesIfReady(fixture.kv, 60_000), true);
  assert.equal(fixture.pending.pending, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.warnings)), [{
    service: "degraded-circuit",
    result: "opened",
    miss_count: 5,
    threshold: 5,
    window_sec: 60,
  }]);
});
