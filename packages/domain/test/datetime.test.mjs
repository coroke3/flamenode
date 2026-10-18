import assert from "node:assert/strict";
import test from "node:test";
import { parseJstDatetimeLocalStrict } from "@flamenode/domain/datetime";
import { parseJstDatetimeLocalStrict as legacy } from "../../../src/lib/utils/dateInput.ts";

test("legacy dateInput re-exports the domain parser (single implementation)", () => {
  assert.equal(legacy, parseJstDatetimeLocalStrict);
});

test("parses datetime-local as Asia/Tokyo and rejects normalised dates", () => {
  assert.deepEqual(parseJstDatetimeLocalStrict("2026-10-17T09:00"), { ok: true, value: Date.UTC(2026, 9, 17, 0, 0) / 1000 });
  assert.deepEqual(parseJstDatetimeLocalStrict(""), { ok: true, value: null });
  for (const bad of ["2026-02-30T10:00", "2026-13-01T00:00", "2026-01-01T24:00", "0099-01-01T00:00", "2026-01-01"]) {
    assert.deepEqual(parseJstDatetimeLocalStrict(bad), { ok: false, reason: "invalid_datetime" }, bad);
  }
});
