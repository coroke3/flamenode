import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shelf, globals, mobilePublic, home] = await Promise.all([
  readFile(new URL("./Shelf.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../styles/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../../styles/mobile-public.css", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/(public)/page.tsx", import.meta.url),
    "utf8",
  ),
]);

test("loop shelfは端でrotateしscrollLeftを1列分補正する", () => {
  assert.match(shelf, /normalizeLoopScroll/);
  assert.match(shelf, /getLoopRotateCount/);
  assert.match(shelf, /rotateForward/);
  assert.match(shelf, /rotateBackward/);
  assert.match(shelf, /flushSync/);
  assert.match(shelf, /el\.scrollLeft = Math\.max\(0, el\.scrollLeft - movedWidth\)/);
  assert.match(shelf, /el\.scrollLeft \+= movedWidth/);
  assert.match(shelf, /requestAnimationFrame/);
  assert.match(shelf, /setLoopItems/);
  assert.match(shelf, /toSourceItems/);
  assert.match(shelf, /getItemStride/);
  assert.match(shelf, /sourceItemsRef/);
  assert.match(shelf, /sourceSignature/);
  assert.match(shelf, /prev\.slice\(0, rotateCount\)/);
  assert.match(shelf, /prev\.slice\(-rotateCount\)/);
  assert.match(shelf, /ensureColumnAligned/);
  assert.match(shelf, /@pad-/);
  assert.doesNotMatch(shelf, /loopCycleWidthRef/);
  assert.doesNotMatch(shelf, /while \(next >= cycleWidth \* 2\)/);
  assert.doesNotMatch(shelf, /fn-shelf-loop-group/);
  assert.match(globals, /\.fn-shelf\[data-loop="true"\]/);
  assert.doesNotMatch(globals, /content-visibility:\s*auto/);
  assert.match(shelf, /getAttribute\("data-loop"\)/);
  assert.match(
    globals,
    /\.fn-shelf\[data-loop="true"\]\[data-mobile-rows="2"\]/,
  );
});

test("モバイル2行では1列=2件単位でloop rotateする", () => {
  assert.match(shelf, /mobileRows === 2/);
  assert.match(shelf, /max-width: 700px/);
  assert.match(shelf, /return 2/);
  assert.match(shelf, /rotateForward\(el, count\)/);
  assert.match(shelf, /rotateBackward\(el, count\)/);
  assert.match(
    shelf,
    /typeof window === "undefined"[\s\S]*?typeof window\.matchMedia !== "function"/,
  );
});

test("モバイル2行loopは奇数件を列境界にパディングする", () => {
  assert.match(shelf, /ensureColumnAligned/);
  assert.match(shelf, /items\.length % rotateCount === 0/);
  assert.match(shelf, /@pad-/);
});

test("loop + mobile 2行はscroll-snapを無効化する", () => {
  assert.match(
    globals,
    /\.fn-shelf\[data-loop="true"\]\[data-mobile-rows="2"\][\s\S]*?scroll-snap-type:\s*none/,
  );
});

test("mobile-publicはloop棚の2行グリッドを壊さない", () => {
  assert.doesNotMatch(
    mobilePublic,
    /\.fn-shelf\[data-loop="true"\][\s\S]*?display:\s*block/,
  );
  assert.match(
    mobilePublic,
    /\.fn-shelf:not\(\[data-mobile-rows="2"\]\)[\s\S]*?grid-auto-columns:\s*min\(82vw,\s*280px\)/,
  );
  assert.doesNotMatch(
    mobilePublic,
    /\.fn-shelf\[data-density="compact"\]\s*\{[\s\S]*?grid-auto-columns:\s*minmax\(104px,\s*32vw\)/,
  );
});

test("autoScroll tickでもnormalizingRefで再入を防ぐ", () => {
  assert.match(
    shelf,
    /normalizingRef\.current = true[\s\S]*?el\.scrollLeft = next[\s\S]*?normalizeLoopScroll[\s\S]*?normalizingRef\.current = false/,
  );
});

test("fill effectはloopItems.lengthのみをdepsにする", () => {
  assert.match(shelf, /loopItems\.length, mobileRows/);
  assert.doesNotMatch(shelf, /loop, loopItems, mobileRows/);
});

test("loop shelfは手動スクロールでもnormalizeLoopScrollをscrollイベントから呼ぶ", () => {
  assert.match(shelf, /normalizingRef/);
  assert.match(shelf, /handleScroll/);
  assert.match(
    shelf,
    /addEventListener\("scroll", handleScroll, \{ passive: true \}\)/,
  );
  assert.match(shelf, /scheduleNormalizeLoopScroll\("both"\)/);
  assert.match(shelf, /runNormalizeLoopScroll/);
  assert.match(shelf, /addEventListener\("scrollend", onScrollEnd\)/);
});

test("右方向loopはfill完了時にrotateBackwardで初期位置をシードする", () => {
  assert.match(shelf, /rightSeedAppliedRef/);
  assert.match(shelf, /autoScrollDirection === "right"/);
  assert.match(shelf, /rotateBackward\(el, getLoopRotateCount\(mobileRows\)\)/);
});

test("トップ3棚はTopLoopShelfで左右交互のloopを使う", () => {
  assert.match(home, /const TOP_LATEST_LOOP_DISPLAY_LIMIT = 40/);
  assert.match(home, /const randomizedLatest = shuffledCopy\(latest\.slice\(0, 100\)\)/);
  assert.match(
    home,
    /const latestLoopItems = randomizedLatest\.slice\(0, TOP_LATEST_LOOP_DISPLAY_LIMIT\)/,
  );
  assert.match(home, /latestLoopItems\.map\(/);
  assert.match(home, /nostalgic\.map\(/);
  assert.doesNotMatch(home, /shuffledCopy\(nostalgic\)/);
  assert.match(home, /title="懐かしの映像"/);
  const directions = [
    ...home.matchAll(/autoScrollDirection="(left|right)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(directions, ["left", "right", "left"]);
  assert.equal((home.match(/<TopLoopShelf/g) ?? []).length, 3);
  assert.doesNotMatch(home, /^\s+loop\s*$/gm);
  assert.doesNotMatch(home, /<Shelf[\s\S]*?loop/);
});
