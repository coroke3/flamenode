import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./degradedCircuitBreaker.ts", import.meta.url),
  "utf8",
);

test("degraded circuitはWorkers isolate globalへKV binding/Promise tailを保持しない", () => {
  const accumulator = source.match(/type MissAccumulator = \{[\s\S]*?\n\};/)?.[0];
  assert.ok(accumulator, "MissAccumulator type");
  assert.doesNotMatch(accumulator, /kv:\s*KVNamespace/);
  assert.doesNotMatch(source, /missFlushTail/);
  assert.match(source, /let missFlushInFlight = false/);
  assert.match(source, /flushPendingMissesIfReady\(\s*kv: KVNamespace,/);
});

test("best-effort bookkeepingはwaitUntil無しでdetached I/Oを開始しない", () => {
  assert.match(source, /function scheduleCircuitBookkeeping\(taskFactory: \(\) => Promise<void>\)/);
  assert.match(source, /if \(!waitUntil\) return/);
  assert.match(
    source,
    /scheduleCircuitBookkeeping\(\(\) => recordDegradedCircuitR2Miss\(nowMs\)\)/,
  );
  assert.match(
    source,
    /scheduleCircuitBookkeeping\(\(\) => recordDegradedCircuitR2Hit\(\)\)/,
  );
});
