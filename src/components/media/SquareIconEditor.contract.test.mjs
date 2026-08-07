import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const readEditor = () =>
  readFileSync(
    fileURLToPath(new URL("./SquareIconEditor.tsx", import.meta.url)),
    "utf8",
  );

test("SquareIconEditor は setState updater 内で currentTarget を読まない", () => {
  const source = readEditor();
  const updaterBlocks = [...source.matchAll(/setTransform\(\(prev\)\s*=>\s*\{?[\s\S]*?\}\)?/g)];
  assert.ok(updaterBlocks.length > 0, "setTransform updater blocks expected");
  for (const match of updaterBlocks) {
    assert.doesNotMatch(match[0], /currentTarget/);
  }
  assert.match(source, /const onScaleChange[\s\S]*currentTarget\.value[\s\S]*setTransform/);
});

test("SquareIconEditor は loadGenerationRef で decode 競合を捨てる", () => {
  const source = readEditor();
  assert.match(source, /loadGenerationRef/);
  assert.match(source, /generation !== loadGenerationRef\.current/);
});

test("SquareIconEditor は scale を updater 外で有限化してから setTransform する", () => {
  const source = readEditor();
  assert.match(source, /onScaleChange/);
  assert.match(source, /Number\.isFinite/);
  assert.match(source, /sanitizeTransform/);
});

test("SquareIconEditor は decode 失敗時に error を clearImageState で消さない", () => {
  const source = readEditor();
  assert.match(source, /clearImageState/);
  const pickCatch = source.match(/const onPickFile[\s\S]*?} catch \(pickError\)[\s\S]*?}\s*finally/);
  assert.ok(pickCatch, "onPickFile catch block expected");
  const catchBody = pickCatch[0];
  assert.match(catchBody, /setError/);
  assert.match(catchBody, /clearImageState\(\)/);
  assert.doesNotMatch(catchBody, /resetEditor\(\)/);
});

test("SquareIconEditor は pointer drag で CSS と canvas 座標を変換する", () => {
  const source = readEditor();
  assert.match(source, /getBoundingClientRect/);
  assert.match(source, /scaleX = canvas\.width \/ rect\.width/);
  assert.match(source, /scaleY = canvas\.height \/ rect\.height/);
  assert.match(source, /onPointerCancel/);
});

test("SquareIconEditor は redraw 失敗を Error Boundary に投げない", () => {
  const source = readEditor();
  assert.match(source, /drawSquareIconPreview[\s\S]*catch/);
  assert.match(source, /画像のプレビューに失敗しました/);
});

test("SquareIconEditor は range input に min/max/step/value を維持する", () => {
  const source = readEditor();
  assert.match(source, /min=\{MIN_SCALE\}/);
  assert.match(source, /max=\{MAX_SCALE\}/);
  assert.match(source, /step=\{0\.01\}/);
  assert.match(source, /value=\{transform\.scale\}/);
});
