import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAccentVars } from "../.test-dist/apps/ops/src/lib/event/accent.js";

test("MIG-0721 accent source parity with CURRENT", () => {
  const current = readFileSync(new URL("../../../src/lib/theme/accent.ts", import.meta.url), "utf8");
  const ops = readFileSync(new URL("../src/lib/event/accent.ts", import.meta.url), "utf8");
  assert.ok(ops.includes(current.trimEnd()), "Ops accent helper must remain source-identical");
});

test("MIG-0721 accent fallback is safe for invalid input", () => {
  const fallback = buildAccentVars(null, "dark");
  assert.deepEqual(buildAccentVars("not-hex", "dark"), fallback);
  assert.deepEqual(buildAccentVars("#xz1", "dark"), fallback);
  assert.deepEqual(buildAccentVars("  ", "dark"), fallback);
  assert.ok(String(fallback["--event-accent"]).startsWith("hsl("));
});

test("MIG-0721 event accent handles 3/6 digit hex and distinct themes", () => {
  assert.deepEqual(buildAccentVars("#abc", "dark"), buildAccentVars("#aabbcc", "dark"));
  assert.deepEqual(buildAccentVars(" AABBCC ", "dark"), buildAccentVars("#aabbcc", "dark"));
  assert.notEqual(buildAccentVars("#ffd400", "light")["--event-accent"], buildAccentVars("#ffd400", "dark")["--event-accent"]);
  for (const theme of ["light", "dark"]) {
    const vars = buildAccentVars("#123456", theme);
    assert.equal(Object.keys(vars).length, 5);
    assert.match(String(vars["--event-accent-soft"]), /^color-mix\(/);
    assert.match(String(vars["--event-accent-ring"]), /^color-mix\(/);
    assert.ok(vars["--event-accent-text"]);
  }
});
