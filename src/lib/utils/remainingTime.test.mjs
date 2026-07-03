import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRemainingTimeMetric } from "./remainingTime.ts";

test("formatRemainingTimeMetric returns null for missing countdowns", () => {
  assert.equal(formatRemainingTimeMetric(null), null);
  assert.equal(formatRemainingTimeMetric(undefined), null);
});

test("formatRemainingTimeMetric uses minutes below one hour", () => {
  assert.deepEqual(formatRemainingTimeMetric(1), { value: "1", unit: "分" });
  assert.deepEqual(formatRemainingTimeMetric(59), { value: "1", unit: "分" });
  assert.deepEqual(formatRemainingTimeMetric(60), { value: "1", unit: "分" });
  assert.deepEqual(formatRemainingTimeMetric(61), { value: "2", unit: "分" });
});

test("formatRemainingTimeMetric uses hours up to one day", () => {
  assert.deepEqual(formatRemainingTimeMetric(3600), { value: "1", unit: "時間" });
  assert.deepEqual(formatRemainingTimeMetric(3601), { value: "2", unit: "時間" });
  assert.deepEqual(formatRemainingTimeMetric(86399), { value: "24", unit: "時間" });
  assert.deepEqual(formatRemainingTimeMetric(86400), { value: "24", unit: "時間" });
});

test("formatRemainingTimeMetric uses days above one day", () => {
  assert.deepEqual(formatRemainingTimeMetric(86401), { value: "2", unit: "日" });
  assert.deepEqual(formatRemainingTimeMetric(172800), { value: "2", unit: "日" });
});

test("formatRemainingTimeMetric uses zero minutes for elapsed countdowns", () => {
  assert.deepEqual(formatRemainingTimeMetric(0), { value: "0", unit: "分" });
  assert.deepEqual(formatRemainingTimeMetric(-1), { value: "0", unit: "分" });
});
