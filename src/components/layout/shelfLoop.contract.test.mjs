import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shelf, globals, home] = await Promise.all([
  readFile(new URL("./Shelf.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../styles/globals.css", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/(public)/page.tsx", import.meta.url),
    "utf8",
  ),
]);

test("loop shelfは複製列と周期幅で継ぎ目なく折り返す", () => {
  assert.match(shelf, /loopCycleWidthRef/);
  assert.match(shelf, /while \(next >= cycleWidth \* 2\) next -= cycleWidth/);
  assert.match(shelf, /while \(next < cycleWidth\) next \+= cycleWidth/);
  assert.equal((shelf.match(/className="fn-shelf-loop-group"/g) ?? []).length, 3);
  assert.match(shelf, /aria-hidden inert/);
  assert.match(globals, /\.fn-shelf\[data-loop="true"\]/);
  assert.match(globals, /\.fn-shelf-loop-track/);
});

test("トップ3棚は新着をランダム化し左右交互のloopを使う", () => {
  assert.match(home, /const randomizedLatest = shuffledCopy\(latest\.slice\(0, 100\)\)/);
  assert.match(home, /const randomizedNostalgic = shuffledCopy\(nostalgic\)/);
  assert.match(home, /title="懐かしの映像"/);
  const directions = [
    ...home.matchAll(/autoScrollDirection="(left|right)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(directions, ["left", "right", "left"]);
  assert.equal((home.match(/\n\s+loop\n/g) ?? []).length, 3);
});
