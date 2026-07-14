import test from "node:test";
import assert from "node:assert/strict";

const ACTIVE_GRACE = 86400;

function resolveEventFreshness(event, now) {
  if (event.visibility_status === "archived") return "archived";
  if (event.visibility_status === "public") return "active";
  const start = event.start_time ?? 0;
  const end = event.end_time ?? 0;
  if (start && end && now >= start && now <= end + ACTIVE_GRACE) return "active";
  return "ended";
}

function pickHigherPriority(a, b) {
  const rank = { high: 0, normal: 1, low: 2 };
  return rank[a] <= rank[b] ? a : b;
}

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
      200 + ACTIVE_GRACE + 1,
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

test("pickHigherPriority", () => {
  assert.equal(pickHigherPriority("normal", "high"), "high");
  assert.equal(pickHigherPriority("low", "normal"), "normal");
});
