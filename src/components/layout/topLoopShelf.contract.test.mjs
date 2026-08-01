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
  assert.match(topLoopCss, /100dvw/);
  assert.match(topLoopCss, /margin-inline:\s*calc\(50% - 50dvw\)/);
  assert.match(topLoopCss, /--fn-page-max/);
});

test("トップページは3箇所でTopLoopShelfを使う", () => {
  assert.equal((home.match(/<TopLoopShelf/g) ?? []).length, 3);
  assert.doesNotMatch(home, /from "@\/components\/layout\/Shelf"/);
});
