import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [component, css, home] = await Promise.all([
  readFile(new URL("./TopLoopShelf.tsx", import.meta.url), "utf8"),
  readFile(new URL("./TopLoopShelf.module.css", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/(public)/page.tsx", import.meta.url),
    "utf8",
  ),
]);

test("トップ棚はevent-archive系の3複製・中央開始方式を使う", () => {
  assert.match(component, /const LOOP_GROUPS = \[0, 1, 2\]/);
  assert.match(component, /cycleWidthRef/);
  assert.match(component, /scroller\.scrollLeft = nextCycle/);
  assert.match(component, /LEFT_RESET_THRESHOLD = 0\.05/);
  assert.match(component, /RIGHT_RESET_THRESHOLD = 2\.95/);
  assert.match(component, /cycleWidth \+ \(current % cycleWidth\)/);
  assert.doesNotMatch(component, /flushSync/);
  assert.doesNotMatch(component, /setLoopItems/);
  assert.doesNotMatch(component, /rotateForward/);
  assert.doesNotMatch(component, /rotateBackward/);
});

test("トップ棚はPCでビューポート幅いっぱいに表示する", () => {
  assert.match(css, /@media \(min-width: 701px\)/);
  assert.match(css, /width:\s*100vw/);
  assert.match(css, /margin-left:\s*calc\(50% - 50vw\)/);
  assert.match(css, /margin-right:\s*calc\(50% - 50vw\)/);
  assert.match(css, /var\(--fn-page-max, 1360px\)/);
});

test("トップページだけが専用棚へ切り替わる", () => {
  assert.match(
    home,
    /import \{ TopLoopShelf as Shelf \} from "@\/components\/layout\/TopLoopShelf"/,
  );
  assert.equal((home.match(/^\s+loop\s*$/gm) ?? []).length, 3);
  const directions = [
    ...home.matchAll(/autoScrollDirection="(left|right)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(directions, ["left", "right", "left"]);
});

test("モバイル2行と操作時の自動送り停止を維持する", () => {
  assert.match(css, /data-mobile-rows="2"/);
  assert.match(css, /grid-template-rows:\s*repeat\(2, auto\)/);
  assert.match(component, /onPointerDown/);
  assert.match(component, /onPointerUp/);
  assert.match(component, /onWheel=\{pauseAfterInteraction\}/);
  assert.match(component, /prefers-reduced-motion: reduce/);
});
