import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatJstDatetimeLocal,
  parseJstDatetimeLocal,
} from "./dateInput.ts";

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

test("formatJstDatetimeLocal formats Unix as JST datetime-local", () => {
  const unix = Math.floor(Date.UTC(2026, 4, 19, 3, 34, 56) / 1000);
  assert.equal(formatJstDatetimeLocal(unix), "2026-05-19T12:34");
});

test("formatJstDatetimeLocal round-trips with parseJstDatetimeLocal", () => {
  const unix = Math.floor(Date.UTC(2026, 4, 18, 15, 15, 0) / 1000);
  const input = formatJstDatetimeLocal(unix);
  assert.equal(input, "2026-05-19T00:15");
  assert.equal(parseJstDatetimeLocal(input), unix);
});

test("formatJstDatetimeLocal returns empty for invalid input", () => {
  assert.equal(formatJstDatetimeLocal(null), "");
  assert.equal(formatJstDatetimeLocal(Number.NaN), "");
});
