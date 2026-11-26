import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatJstDatetimeLocal } from "../.test-dist/apps/ops/src/lib/event/dateInput.js";

const unix = (...parts) => Date.UTC(...parts) / 1000;

test("MIG-0721 datetime formatter is source-identical to CURRENT", () => {
  const current = readFileSync(new URL("../../../src/lib/utils/dateInput.ts", import.meta.url), "utf8");
  const target = readFileSync(new URL("../src/lib/event/dateInput.ts", import.meta.url), "utf8");
  const start = current.indexOf("const jstDatetimeLocalFormatter");
  const end = current.indexOf("export function parseJstDatetimeLocal(", start);
  assert.ok(start >= 0 && end > start);
  assert.equal(target.slice(target.indexOf("\n") + 1).trimEnd(), current.slice(start, end).trimEnd());
});

test("MIG-0721 formats JST minute precision without rounding seconds", () => {
  assert.equal(formatJstDatetimeLocal(unix(2026, 4, 19, 3, 34, 56)), "2026-05-19T12:34");
  assert.equal(formatJstDatetimeLocal(unix(2026, 4, 18, 15, 15)), "2026-05-19T00:15");
});

test("MIG-0721 preserves Tokyo day, month, year and leap-day boundaries", () => {
  assert.equal(formatJstDatetimeLocal(unix(2026, 11, 31, 15)), "2027-01-01T00:00");
  assert.equal(formatJstDatetimeLocal(unix(2028, 1, 28, 15)), "2028-02-29T00:00");
  assert.equal(formatJstDatetimeLocal(0), "1970-01-01T09:00");
});

test("MIG-0721 invalid or absent timestamps remain empty", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, 1e20, "0"]) {
    assert.equal(formatJstDatetimeLocal(value), "");
  }
});
