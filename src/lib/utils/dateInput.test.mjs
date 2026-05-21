import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJstDatetimeLocal } from "./dateInput.ts";

test("parseJstDatetimeLocal treats datetime-local as JST", () => {
  const actual = parseJstDatetimeLocal("2026-05-19T12:34:56");
  const expected = Math.floor(Date.UTC(2026, 4, 19, 3, 34, 56) / 1000);
  assert.equal(actual, expected);
});

test("parseJstDatetimeLocal accepts minute precision", () => {
  const actual = parseJstDatetimeLocal("2026-05-19T00:15");
  const expected = Math.floor(Date.UTC(2026, 4, 18, 15, 15, 0) / 1000);
  assert.equal(actual, expected);
});

test("parseJstDatetimeLocal rejects empty input", () => {
  assert.equal(parseJstDatetimeLocal(""), null);
  assert.equal(parseJstDatetimeLocal(null), null);
});
