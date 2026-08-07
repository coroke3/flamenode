import assert from "node:assert/strict";
import { test } from "node:test";
import { computeFloatingMenuPosition } from "./floatingMenuPosition.ts";

const menu = { width: 140, height: 160 };
const viewport = { width: 800, height: 600 };

test("中央: ボタン下・右揃え", () => {
  const result = computeFloatingMenuPosition({
    anchor: { top: 200, left: 300, width: 60, height: 28 },
    menu,
    viewport,
  });
  assert.equal(result.placement, "bottom-end");
  assert.equal(result.top, 200 + 28 + 6);
  assert.equal(result.left, 300 + 60 - 140);
});

test("下端: 上へ flip", () => {
  const result = computeFloatingMenuPosition({
    anchor: { top: 520, left: 300, width: 60, height: 28 },
    menu,
    viewport,
  });
  assert.equal(result.placement, "top-end");
  assert.ok(result.top + menu.height <= 520 - 6 + 1);
});

test("上端: 下へ配置（clamp で viewport 内）", () => {
  const result = computeFloatingMenuPosition({
    anchor: { top: 4, left: 300, width: 60, height: 28 },
    menu,
    viewport,
    margin: 8,
  });
  assert.equal(result.placement, "bottom-end");
  assert.ok(result.top >= 8);
});

test("右端: 左へ clamp", () => {
  const result = computeFloatingMenuPosition({
    anchor: { top: 200, left: 760, width: 60, height: 28 },
    menu,
    viewport,
    margin: 8,
  });
  assert.equal(result.left, viewport.width - menu.width - 8);
});

test("左端: 右へ clamp", () => {
  const result = computeFloatingMenuPosition({
    anchor: { top: 200, left: 0, width: 40, height: 28 },
    menu,
    viewport,
    margin: 8,
  });
  assert.equal(result.left, 8);
});

test("狭い viewport: margin 内に収める", () => {
  const narrow = { width: 200, height: 240 };
  const result = computeFloatingMenuPosition({
    anchor: { top: 100, left: 100, width: 50, height: 24 },
    menu: { width: 180, height: 200 },
    viewport: narrow,
    margin: 8,
  });
  assert.ok(result.left >= 8);
  assert.ok(result.left + 180 <= narrow.width - 8 + 0.1);
  assert.ok(result.top >= 8);
  assert.ok(result.top + 200 <= narrow.height - 8 + 0.1);
});

test("menu が viewport より大きい: margin に clamp", () => {
  const result = computeFloatingMenuPosition({
    anchor: { top: 100, left: 100, width: 40, height: 20 },
    menu: { width: 900, height: 700 },
    viewport,
    margin: 8,
  });
  assert.equal(result.left, 8);
  assert.equal(result.top, 8);
});
