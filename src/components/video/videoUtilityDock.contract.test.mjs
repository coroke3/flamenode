import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function read(relative) {
  return fs.readFileSync(path.join(here, relative), "utf8");
}

test("VideoUtilityDock keeps both panels mounted and wires history", () => {
  const body = read("VideoUtilityDock.tsx");
  assert.match(body, /useState<ActivePanel>\(null\)/);
  assert.match(body, /<ChapterCommentPanel/);
  assert.match(body, /aria-hidden=\{/);
  assert.match(body, /pushState/);
  assert.match(body, /popstate/);
  assert.match(body, /ResizeObserver/);
  assert.match(body, /playlistItems\.length === 0/);
  assert.match(body, /Escape/);
});

test("ChapterCommentPanel preserves composer flow", () => {
  const body = read("ChapterCommentPanel.tsx");
  assert.match(body, /presentation="responsive"/);
  assert.match(body, /現在位置にコメントする/);
  assert.match(body, /setDraftTime\(currentTime\)/);
  assert.match(body, /presentation="inline-sheet"/);
  assert.match(body, /data-chapter-time/);
});

test("usePlayerTime delegates to subscribePlayerTime cleanup", () => {
  const body = read("usePlayerTime.ts");
  assert.match(body, /return subscribePlayerTime/);
});
