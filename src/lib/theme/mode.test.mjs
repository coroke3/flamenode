import test from "node:test";
import assert from "node:assert/strict";

import {
  nextThemeMode,
  normalizeThemeMode,
  resolveTheme,
} from "./mode.ts";

test("theme mode: 保存値を正規化する", () => {
  assert.equal(normalizeThemeMode("light"), "light");
  assert.equal(normalizeThemeMode("system"), "system");
  assert.equal(normalizeThemeMode("legacy"), "system");
});

test("theme mode: system は OS 設定へ解決する", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("theme mode: 切替は system を含む3状態を巡回する", () => {
  assert.equal(nextThemeMode("system"), "light");
  assert.equal(nextThemeMode("light"), "dark");
  assert.equal(nextThemeMode("dark"), "system");
});
