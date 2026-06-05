import test from "node:test";
import assert from "node:assert/strict";

const ACTIVE_GRACE = 86400;

function resolveEventFreshness(event, now) {
  if (event.is_archived === 1) return "archived";
  if (event.is_active === 1 || event.is_entry_open === 1) return "active";
  const start = event.start_time ?? 0;
  const end = event.end_time ?? 0;
  if (start && end && now >= start && now <= end + ACTIVE_GRACE) return "active";
  return "ended";
}

function pickHigherPriority(a, b) {
  const rank = { high: 0, normal: 1, low: 2 };
  return rank[a] <= rank[b] ? a : b;
}

const FORBIDDEN = new Set(["submitted_by_discord_user_id", "discord_user_id"]);

function assertNoForbidden(value, path = "root") {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbidden(v, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, child] of Object.entries(value)) {
    if (FORBIDDEN.has(k)) {
      throw new Error(`Forbidden ${path}.${k}`);
    }
    assertNoForbidden(child, `${path}.${k}`);
  }
}

test("resolveEventFreshness archived", () => {
  assert.equal(
    resolveEventFreshness(
      { is_archived: 1, is_active: 1, is_entry_open: 1, start_time: 0, end_time: 0 },
      1000,
    ),
    "archived",
  );
});

test("resolveEventFreshness active flags", () => {
  assert.equal(
    resolveEventFreshness(
      { is_archived: 0, is_active: 0, is_entry_open: 1, start_time: null, end_time: null },
      1000,
    ),
    "active",
  );
});

test("resolveEventFreshness ended", () => {
  assert.equal(
    resolveEventFreshness(
      { is_archived: 0, is_active: 0, is_entry_open: 0, start_time: 100, end_time: 200 },
      200 + ACTIVE_GRACE + 1,
    ),
    "ended",
  );
});

test("no frozen state in freshness union", () => {
  const sample = resolveEventFreshness(
    { is_archived: 0, is_active: 0, is_entry_open: 0, start_time: 1, end_time: 2 },
    999999,
  );
  assert.ok(["active", "ended", "archived"].includes(sample));
  assert.notEqual(sample, "frozen");
});

test("pickHigherPriority", () => {
  assert.equal(pickHigherPriority("normal", "high"), "high");
  assert.equal(pickHigherPriority("low", "normal"), "normal");
});

test("forbidden keys rejected in public json", () => {
  assert.throws(() =>
    assertNoForbidden({ title: "ok", submitted_by_discord_user_id: "x" }),
  );
});
