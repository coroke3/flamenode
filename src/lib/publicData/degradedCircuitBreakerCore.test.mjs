import assert from "node:assert/strict";
import test from "node:test";
import {
  currentDegradedCircuitMinuteBucket,
  DEGRADED_CIRCUIT_MISS_THRESHOLD,
  shouldCloseDegradedCircuit,
  shouldOpenDegradedCircuit,
} from "./degradedCircuitBreakerCore.ts";

test("degraded circuit opens at miss threshold", () => {
  assert.equal(shouldOpenDegradedCircuit(DEGRADED_CIRCUIT_MISS_THRESHOLD - 1), false);
  assert.equal(shouldOpenDegradedCircuit(DEGRADED_CIRCUIT_MISS_THRESHOLD), true);
});

test("degraded circuit closes after consecutive R2 hits", () => {
  assert.equal(shouldCloseDegradedCircuit(2), false);
  assert.equal(shouldCloseDegradedCircuit(3), true);
});

test("minute bucket aligns to 60 second windows", () => {
  assert.equal(currentDegradedCircuitMinuteBucket(0), 0);
  assert.equal(currentDegradedCircuitMinuteBucket(59_999), 0);
  assert.equal(currentDegradedCircuitMinuteBucket(60_000), 1);
});
