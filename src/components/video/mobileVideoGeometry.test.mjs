import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMobileVideoGeometryCssVars,
  computeMobileVideoGeometry,
  metricsToCssVars,
  px,
} from "./mobileVideoGeometry.ts";

test("pxは0未満を0に丸めてpx文字列にする", () => {
  assert.equal(px(-3), "0px");
  assert.equal(px(12.3456), "12.35px");
  assert.equal(px(100), "100px");
});

test("縦向きではviewport幅いっぱいにプレイヤーを配置する", () => {
  const metrics = computeMobileVideoGeometry({
    headerBottom: 56,
    viewportHeight: 700,
    viewportWidth: 390,
    viewportTop: 0,
    viewportLeft: 0,
    windowInnerHeight: 700,
  });

  assert.equal(metrics.playerWidth, 390);
  assert.equal(metrics.playerHeight, 390 / (16 / 9));
  assert.equal(metrics.keyboardInset, 0);
});

test("横向きでは利用可能高さでプレイヤー幅を制約する", () => {
  const metrics = computeMobileVideoGeometry({
    headerBottom: 48,
    viewportHeight: 360,
    viewportWidth: 780,
    viewportTop: 0,
    viewportLeft: 0,
    windowInnerHeight: 360,
  });

  const availableHeight = 360 - 48 - 160;
  const expectedWidth = availableHeight * (16 / 9);

  assert.equal(metrics.playerWidth, expectedWidth);
  assert.equal(metrics.playerHeight, availableHeight);
});

test("初回キーボード表示でも通常寸法を維持し縮小しない", () => {
  const metrics = computeMobileVideoGeometry({
    headerBottom: 56,
    viewportHeight: 420,
    viewportWidth: 390,
    viewportTop: 0,
    viewportLeft: 0,
    windowInnerHeight: 700,
  });

  assert.equal(metrics.keyboardInset, 280);
  assert.equal(metrics.playerWidth, 390);
  assert.equal(metrics.playerHeight, 390 / (16 / 9));
});

test("キーボード表示中は凍結寸法を維持し縮小しない", () => {
  const frozen = { playerWidth: 390, playerHeight: 390 / (16 / 9) };
  const metrics = computeMobileVideoGeometry(
    {
      headerBottom: 56,
      viewportHeight: 420,
      viewportWidth: 390,
      viewportTop: 0,
      viewportLeft: 0,
      windowInnerHeight: 700,
    },
    frozen,
  );

  assert.equal(metrics.keyboardInset, 280);
  assert.equal(metrics.playerWidth, frozen.playerWidth);
  assert.equal(metrics.playerHeight, frozen.playerHeight);
});

test("キーボード表示中でも位置とinsetは更新される", () => {
  const frozen = { playerWidth: 390, playerHeight: 219.375 };
  const metrics = computeMobileVideoGeometry(
    {
      headerBottom: 80,
      viewportHeight: 420,
      viewportWidth: 390,
      viewportTop: 12,
      viewportLeft: 0,
      windowInnerHeight: 700,
    },
    frozen,
  );

  assert.equal(metrics.effectiveHeaderBottom, 80);
  assert.equal(metrics.playerLeft, 0);
  assert.equal(metrics.playerBottom, 80 + frozen.playerHeight);
  assert.equal(metrics.keyboardInset, 268);
});

test("applyMobileVideoGeometryCssVarsは未変化の変数を書き換えない", () => {
  const root = {
    style: {
      properties: new Map(),
      setProperty(name, value) {
        this.properties.set(name, value);
      },
      removeProperty(name) {
        this.properties.delete(name);
      },
    },
  };

  const vars = metricsToCssVars(
    computeMobileVideoGeometry({
      headerBottom: 56,
      viewportHeight: 700,
      viewportWidth: 390,
      viewportTop: 0,
      viewportLeft: 0,
      windowInnerHeight: 700,
    }),
  );

  applyMobileVideoGeometryCssVars(root, vars, null);
  const firstWrites = new Map(root.style.properties);

  applyMobileVideoGeometryCssVars(root, vars, vars);
  assert.deepEqual(
    [...root.style.properties.entries()],
    [...firstWrites.entries()],
  );

  const shifted = {
    ...vars,
    left: px(8),
    bottom: px(parseFloat(vars.bottom) + 8),
  };

  applyMobileVideoGeometryCssVars(root, shifted, vars);
  assert.equal(root.style.properties.get("--fn-mobile-player-left"), shifted.left);
  assert.equal(root.style.properties.get("--fn-mobile-player-width"), vars.width);
  assert.equal(root.style.properties.get("--fn-mobile-player-height"), vars.height);
});
