import test from "node:test";
import assert from "node:assert/strict";
import { resolveEventFreshness } from "../workers/json-generator/freshness.ts";

test("public event without an end remains active", () => {
  assert.equal(
    resolveEventFreshness(
      { visibility_status: "public", start_time: null, end_time: null },
      1000,
    ),
    "active",
  );
});

test("private and legacy visibility are not public freshness", () => {
  assert.equal(
    resolveEventFreshness(
      { visibility_status: "private", start_time: 100, end_time: 200 },
      150,
    ),
    "ended",
  );
  assert.equal(
    resolveEventFreshness(
      { visibility_status: "archived", start_time: 100, end_time: 200 },
      150,
    ),
    "ended",
  );
});

test("public event becomes ended after the cache grace period", () => {
  assert.equal(
    resolveEventFreshness(
      { visibility_status: "public", start_time: 100, end_time: 200 },
      200 + 86400 + 1,
    ),
    "ended",
  );
});

test("freshness has only active and ended", () => {
  const sample = resolveEventFreshness(
    { visibility_status: "private", start_time: 1, end_time: 2 },
    999999,
  );
  assert.ok(["active", "ended"].includes(sample));
});
