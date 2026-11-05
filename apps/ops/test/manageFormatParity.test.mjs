import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUnix,
  formatRelative,
} from "../.test-dist/apps/ops/src/routes/manage/manageFormat.js";

const unixSec = Date.UTC(2026, 9, 31, 15, 30) / 1000; // 2026-11-01 00:30 JST
const instant = new Date(unixSec * 1000 + 900);

test("MIG-0719: Ops Manage formats numeric strings and Dates like CURRENT in JST", () => {
  for (const value of [unixSec, String(unixSec), `  ${unixSec}  `, instant]) {
    assert.equal(formatUnix(value), "2026/11/01 00:30");
    assert.equal(formatUnix(value, { dateOnly: true }), "2026/11/01");
    assert.equal(formatRelative(value, (unixSec + 5 * 60) * 1000), "5分前");
    assert.equal(formatRelative(value, (unixSec + 10) * 1000), "今");
  }
});

test("MIG-0719: Ops Manage rejects missing, nonnumeric and nonfinite time inputs", () => {
  const invalid = [null, undefined, "", " ", "not-a-date", "Infinity",
    Number.NaN, Infinity, -Infinity, true, {}, new Date(Number.NaN)];
  for (const value of invalid) {
    assert.equal(formatUnix(value), "-", String(value));
    assert.equal(formatUnix(value, { dateOnly: true }), "-", String(value));
    assert.equal(formatRelative(value, (unixSec + 5 * 60) * 1000), "", String(value));
  }
});

test("MIG-0719: Ops Manage retains zero and negative Unix seconds", () => {
  for (const value of [0, "0", new Date(0)]) {
    assert.equal(formatUnix(value, { dateOnly: true }), "1970/01/01");
  }
  assert.equal(formatUnix(-1, { dateOnly: true }), "1970/01/01");
});
