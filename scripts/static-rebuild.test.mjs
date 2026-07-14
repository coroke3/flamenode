import test from "node:test";
import assert from "node:assert/strict";
import { resolveEventFreshness } from "../workers/json-generator/freshness.ts";

test("resolveEventFreshness archived", () => {
  assert.equal(
    resolveEventFreshness(
      { visibility_status: "archived", start_time: 0, end_time: 0 },
      1000,
    ),
    "archived",
  );
});

test("resolveEventFreshness public visibility", () => {
  assert.equal(
    resolveEventFreshness(
      { visibility_status: "public", start_time: null, end_time: null },
      1000,
    ),
    "active",
  );
});

test("resolveEventFreshness ended", () => {
  assert.equal(
    resolveEventFreshness(
      { visibility_status: "private", start_time: 100, end_time: 200 },
      200 + 86400 + 1,
    ),
    "ended",
  );
});

test("no frozen state in freshness union", () => {
  const sample = resolveEventFreshness(
    { visibility_status: "draft", start_time: 1, end_time: 2 },
    999999,
  );
  assert.ok(["active", "ended", "archived"].includes(sample));
  assert.notEqual(sample, "frozen");
});
