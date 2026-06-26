import test from "node:test";
import assert from "node:assert/strict";

import { buildAccentVars } from "./accent.ts";

test("buildAccentVars: 無効 hex はデフォルト", () => {
  const v = buildAccentVars(null);
  assert.ok(v["--event-accent"], "accent variable should exist");
  assert.ok(v["--event-accent-strong"], "strong variable should exist");
});

test("buildAccentVars: ライトとダークで違う結果", () => {
  const a = buildAccentVars("#ffd400", "light");
  const b = buildAccentVars("#ffd400", "dark");
  assert.notEqual(a["--event-accent"], b["--event-accent"]);
});
