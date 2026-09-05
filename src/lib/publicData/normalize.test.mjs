import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUnixDate } from "./normalize.ts";

test("normalizeUnixDate converts a valid Unix timestamp", () => {
  assert.equal(
    normalizeUnixDate(1_700_000_000)?.toISOString(),
    "2023-11-14T22:13:20.000Z",
  );
});

test("normalizeUnixDate rejects non-finite and Date-range timestamps", () => {
  for (const value of [null, "", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
    assert.equal(normalizeUnixDate(value), null);
  }
});
