import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildPartsJson } from "@flamenode/domain/event";

test("MIG-0652 U01: empty and blank part text stays null", () => {
  for (const input of [null, undefined, "", "   ", "  \n\t\r\n"]) {
    assert.equal(buildPartsJson(input), null);
  }
});

test("MIG-0652 U01: preserve CRLF handling, trimmed order and exact deduplication", () => {
  assert.equal(buildPartsJson("  開会  \r\n\r\n本編\n  開会 \n終演  "), JSON.stringify(["開会", "本編", "終演"]));
  assert.equal(buildPartsJson("Intro\nintro"), JSON.stringify(["Intro", "intro"]));
});

test("MIG-0652 U01: truncate before deduplication to 40 UTF-16 units", () => {
  const a = "a".repeat(40);
  assert.equal(buildPartsJson(`${a}x\n${a}y\nb`), JSON.stringify([a, "b"]));
  // Keep the CURRENT slice behavior (even when it cuts a surrogate pair).
  const cut = "a".repeat(39) + "😀";
  assert.equal(buildPartsJson(cut), JSON.stringify([cut.slice(0, 40)]));
});

test("MIG-0652 U01: 20 unique parts maximum, in original order", () => {
  const values = Array.from({ length: 25 }, (_, i) => `part-${i + 1}`);
  assert.equal(buildPartsJson(values.join("\n")), JSON.stringify(values.slice(0, 20)));
});

test("MIG-0652 U01: CURRENT eventForm export points to same domain function", async () => {
  const legacy = await readFile(new URL("../../../src/lib/event/eventForm.ts", import.meta.url), "utf8");
  assert.ok(legacy.includes('export { buildPartsJson } from "@flamenode/domain/event";'));
  assert.ok(!legacy.includes("export function buildPartsJson("));
});
