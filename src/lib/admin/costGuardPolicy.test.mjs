import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCostGuardThresholds,
  recommendCostGuardMode,
} from "./costGuardPolicy.ts";

test("parseCostGuardThresholds: invalid JSON falls back to defaults", () => {
  const parsed = parseCostGuardThresholds("{bad");
  assert.equal(parsed.economy, 0.75);
  assert.equal(parsed.read_only, 0.9);
});

test("parseCostGuardThresholds: clamps values into ratio range", () => {
  const parsed = parseCostGuardThresholds(
    JSON.stringify({ economy: -1, read_only: 0.8, static_only: 2, maintenance: 1 }),
  );
  assert.equal(parsed.economy, 0);
  assert.equal(parsed.read_only, 0.8);
  assert.equal(parsed.static_only, 1);
});

test("recommendCostGuardMode: returns normal when no snapshot exists", () => {
  assert.deepEqual(recommendCostGuardMode(null), {
    mode: "normal",
    reasons: [],
    highestRatio: 0,
  });
});

test("recommendCostGuardMode: escalates from economy to read_only", () => {
  const economy = recommendCostGuardMode({ d1_rows_written_today: 80_000 });
  assert.equal(economy.mode, "economy");
  assert.ok(economy.reasons.some((r) => r.includes("d1_rows_written_today")));

  const readOnly = recommendCostGuardMode({ d1_rows_written_today: 95_000 });
  assert.equal(readOnly.mode, "read_only");
});

test("recommendCostGuardMode: high usage reaches maintenance", () => {
  const result = recommendCostGuardMode({ workers_requests_today: 100_000 });
  assert.equal(result.mode, "maintenance");
  assert.equal(result.highestRatio, 1);
});
