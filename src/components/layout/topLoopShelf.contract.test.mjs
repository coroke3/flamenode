import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [topLoopShelf, topLoopCss, home] = await Promise.all([
  readFile(new URL("./TopLoopShelf.tsx", import.meta.url), "utf8"),
  readFile(new URL("./TopLoopShelf.module.css", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/(public)/page.tsx", import.meta.url),
    "utf8",
  ),
]);

test("TopLoopShelfはflushSyncとsetLoopItems rotateを使わない", () => {
  assert.doesNotMatch(topLoopShelf, /flushSync/);
  assert.doesNotMatch(topLoopShelf, /setLoopItems/);
  assert.doesNotMatch(topLoopShelf, /rotateForward/);
  assert.doesNotMatch(topLoopShelf, /rotateBackward/);
  assert.doesNotMatch(topLoopShelf, /normalizeLoopScroll/);
});

test("TopLoopShelfは3グループ複製とdata-loop-groupを持つ", () => {
  assert.match(topLoopShelf, /data-loop-group="0"/);
  assert.match(topLoopShelf, /data-loop-group="1"/);
  assert.match(topLoopShelf, /data-loop-group="2"/);
  assert.match(topLoopShelf, /\$\{item\.sourceKey\}@\$\{groupIndex\}-\$\{index\}/);
});

test("TopLoopShelfはcycleWidth計測とscrollLeftテレポート閾値を持つ", () => {
  assert.match(topLoopShelf, /measureCycleWidth/);
  assert.match(topLoopShelf, /cycleWidthRef/);
  assert.match(topLoopShelf, /leftThreshold = cycleWidth \* 0\.5/);
  assert.match(topLoopShelf, /rightThreshold = cycleWidth \* 1\.5/);
  assert.match(topLoopShelf, /scrollLeft \+ cycleWidth/);
  assert.match(topLoopShelf, /scrollLeft - cycleWidth/);
  assert.match(topLoopShelf, /scroller\.scrollLeft = cycleWidth/);
  assert.match(topLoopShelf, /ResizeObserver/);
  assert.match(topLoopShelf, /previousCycleWidth/);
  assert.match(topLoopShelf, /relativeOffset \* nextCycleWidth/);
});

test("TopLoopShelfはcloneグループにinertとaria-hiddenを付与する", () => {
  assert.match(
    topLoopShelf,
    /data-loop-group="0"[\s\S]*?aria-hidden="true"[\s\S]*?inert/,
  );
  assert.match(
    topLoopShelf,
    /data-loop-group="2"[\s\S]*?aria-hidden="true"[\s\S]*?inert/,
  );
});

test("TopLoopShelfはautoScrollDirection left/rightに対応する", () => {
  assert.match(topLoopShelf, /autoScrollDirection === "left" \? 1 : -1/);
  assert.match(topLoopShelf, /directionRef\.current/);
  assert.match(topLoopShelf, /data-auto-direction=\{autoScrollDirection\}/);
  assert.match(topLoopShelf, /autoScrollCarryRef/);
});

test("TopLoopShelfはfullBleed CSSを持つ", () => {
  assert.match(topLoopCss, /\.fullBleed/);
  assert.match(topLoopCss, /100vw/);
  assert.match(topLoopCss, /margin-left:\s*calc\(50% - 50vw\)/);
  assert.match(topLoopCss, /overflow-x:\s*clip/);
  assert.match(topLoopCss, /--fn-page-max/);
});

test("TopLoopShelfはモバイル2行グリッドとdata-mobile-rowsを持つ", () => {
  assert.match(topLoopCss, /data-mobile-rows="2"/);
  assert.match(topLoopCss, /grid-template-rows:\s*repeat\(2,/);
  assert.match(topLoopShelf, /data-mobile-rows=\{mobileRows\}/);
  assert.match(topLoopShelf, /mobileRows === 2/);
});

test("TopLoopShelfはpause・pointer・wheel・reduced motionを持つ", () => {
  assert.match(topLoopShelf, /pointerActiveRef/);
  assert.match(topLoopShelf, /pauseAfterInteraction/);
  assert.match(topLoopShelf, /pauseOnWheel/);
  assert.match(topLoopShelf, /prefers-reduced-motion: reduce/);
  assert.match(topLoopShelf, /reducedMotion/);
});

test("TopLoopShelfはIntersectionObserverとvisibilitychangeを持つ", () => {
  assert.match(topLoopShelf, /IntersectionObserver/);
  assert.match(topLoopShelf, /visibilitychange/);
  assert.match(topLoopShelf, /inViewport/);
  assert.match(topLoopShelf, /documentVisible/);
});

test("TopLoopShelfはneedsLoop分岐と短い配列を扱う", () => {
  assert.match(topLoopShelf, /needsLoop/);
  assert.match(topLoopShelf, /sourceItems\.length < 2/);
  assert.match(topLoopShelf, /data-loop-group="1"[\s\S]*?groupItems/);
  assert.match(
    topLoopShelf,
    /if \(needsLoop\) return;[\s\S]*?scroller\.scrollLeft = 0/,
  );
});

test("TopLoopShelfはモバイル2行loopで奇数件を列境界にパディングする", () => {
  assert.match(topLoopShelf, /ensureColumnAligned/);
  assert.match(topLoopShelf, /items\.length % rotateCount === 0/);
  assert.match(topLoopShelf, /@pad-/);
  assert.match(topLoopShelf, /loopSourceItems/);
  assert.match(topLoopShelf, /isMobileViewport/);
  assert.match(topLoopShelf, /useSyncExternalStore/);
  assert.match(topLoopShelf, /subscribeMaxWidth700/);
  assert.match(topLoopShelf, /MOBILE_SHELF_MAX_WIDTH_PX = 700/);
  assert.match(topLoopShelf, /MOBILE_MEDIA_QUERY/);
  assert.match(topLoopShelf, /item\.node == null/);
  assert.match(topLoopShelf, /aria-hidden="true"/);
});

test("TopLoopShelfはgetShelfGapとuseMobileStride付きgetScrollStrideを持つ", () => {
  assert.match(topLoopShelf, /function getShelfGap/);
  assert.match(topLoopShelf, /getShelfGap\(scroller\)/);
  assert.match(topLoopShelf, /getShelfGap\(groupEl\)/);
  assert.match(topLoopShelf, /useMobileStride: boolean/);
  assert.match(
    topLoopShelf,
    /mobileRows === 2 && isMobileViewport/,
  );
  assert.doesNotMatch(topLoopShelf, /function isMobileTwoRows/);
  assert.doesNotMatch(topLoopShelf, /function getElementGap/);
});

test("TopLoopShelfはpropsにJSDocを持つ", () => {
  assert.match(topLoopShelf, /\/\*\* 自動送り速度/);
  assert.match(topLoopShelf, /\/\*\* 700px 以下での行数/);
  assert.match(topLoopShelf, /\/\*\* ユーザー操作後に自動送りを再開するまでの待機時間/);
  assert.match(topLoopShelf, /\/\*\* ホイール操作で自動送りを一時停止する/);
  assert.match(topLoopShelf, /\/\*\* カードが画面上で流れる向き/);
  assert.match(topLoopShelf, /\/\*\* スクロール領域の aria-label/);
});

test("TopLoopShelf CSSはshelf-rail変数と701px矢印を持つ", () => {
  assert.match(topLoopCss, /--shelf-rail-inline-start/);
  assert.match(topLoopCss, /--shelf-rail-inline-end/);
  assert.match(topLoopCss, /padding-left:\s*var\(--shelf-rail-inline-start\)/);
  assert.match(topLoopCss, /padding-right:\s*var\(--shelf-rail-inline-end\)/);
  assert.match(
    topLoopCss,
    /\.arrowPrev[\s\S]*?var\(--shelf-rail-inline-start\)/,
  );
  assert.match(
    topLoopCss,
    /\.arrowNext[\s\S]*?var\(--shelf-rail-inline-end\)/,
  );
  assert.match(topLoopCss, /@media \(min-width: 701px\)[\s\S]*?\.arrow[\s\S]*?display:\s*inline-flex/);
  assert.match(topLoopCss, /MOBILE_SHELF_MAX_WIDTH_PX \(700\)/);
  assert.doesNotMatch(topLoopCss, /@media \(min-width: 768px\)/);
});

test("TopLoopShelfの矢印aria-labelはShelfと一致する", () => {
  assert.match(topLoopShelf, /aria-label="前へスクロール"/);
  assert.match(topLoopShelf, /aria-label="次へスクロール"/);
});

test("TopLoopShelfの矢印にfocus-visible outlineがある", () => {
  assert.match(topLoopCss, /\.arrow:focus-visible/);
  assert.match(topLoopCss, /outline:\s*2px solid var\(--accent-primary\)/);
});

test("トップページは3箇所でTopLoopShelfを使う", () => {
  assert.equal((home.match(/<TopLoopShelf/g) ?? []).length, 3);
  assert.doesNotMatch(home, /from "@\/components\/layout\/Shelf"/);
  const directions = [
    ...home.matchAll(/autoScrollDirection="(left|right)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(directions, ["left", "right", "left"]);
});
