import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { EVENT_ID_PATTERN, normalizeOptionalEventId } from "@flamenode/domain/event";

test("MIG-0652 U01: event ID pattern preserves CURRENT ASCII route-safe contract", () => {
  for (const valid of ["a", "Event2026", "ab_cd-09", "_", "-", "A".repeat(64)]) {
    assert.equal(EVENT_ID_PATTERN.test(valid), true, valid);
  }
  for (const invalid of ["", "A".repeat(65), "two words", "x/y", "x.y", "日本語", "abc\\ndef", " a ", "🔥"]) {
    assert.equal(EVENT_ID_PATTERN.test(invalid), false, invalid);
  }
});

test("MIG-0652 U01: browser empty-string preprocessing preserves non-empty values and non-strings", () => {
  for (const blank of ["", " ", "\n\t "]) {
    assert.equal(normalizeOptionalEventId(blank), undefined);
  }
  for (const raw of ["x", " x ", "\nx\t", 0, null, undefined, false]) {
    assert.equal(normalizeOptionalEventId(raw), raw);
  }
});

test("MIG-0652 U01: legacy EventForm delegates both ID policies to shared domain", async () => {
  const source = await readFile(new URL("../../../src/lib/event/eventForm.ts", import.meta.url), "utf8");
  assert.ok(source.includes('import { normalizeOptionalEventId } from "@flamenode/domain/event";'));
  assert.ok(source.includes('export { EVENT_ID_PATTERN } from "@flamenode/domain/event";'));
  assert.ok(source.includes("id: z.preprocess("));
  assert.ok(!source.includes("export const EVENT_ID_PATTERN ="));
  assert.ok(!source.includes("function normalizeOptionalEventId("));
});
