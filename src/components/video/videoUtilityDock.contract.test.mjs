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
  assert.match(body, /matchMedia/);
  assert.match(body, /playlistItems\.length === 0/);
  assert.match(body, /authUnavailable=\{authUnavailable\}/);
  assert.match(body, /needsTermsAcceptance=\{needsTermsAcceptance\}/);
  assert.match(body, /rulesHref=\{rulesHref\}/);
  assert.match(body, /Escape/);
});

test("VideoUtilityDockはNextのhistory stateを保持しリンク遷移前にsynthetic entryを消費する", () => {
  const body = read("VideoUtilityDock.tsx");
  assert.match(body, /const baseState =/);
  assert.match(
    body,
    /\{ \.\.\.baseState, \[HISTORY_STATE_KEY\]: true \}/,
  );
  assert.match(body, /pendingNavigationRef/);
  assert.match(body, /onClickCapture=\{handlePanelNavigationCapture\}/);
  assert.match(body, /event\.preventDefault\(\)/);
  assert.match(body, /pendingNavigationRef\.current = anchor\.href/);
  assert.match(body, /window\.history\.back\(\)/);
  assert.match(body, /router\.push/);
});

test("ChapterCommentPanel preserves composer flow and mirrors TOS guard", () => {
  const body = read("ChapterCommentPanel.tsx");
  assert.match(body, /presentation="responsive"/);
  assert.match(body, /現在位置にコメントする/);
  assert.match(body, /setDraftTime\(currentTime\)/);
  assert.match(body, /presentation="inline-sheet"/);
  assert.match(body, /data-chapter-time/);
  assert.match(body, /authUnavailable \? \(/);
  assert.match(body, /ログイン状態を一時的に確認できません/);
  assert.match(body, /needsTermsAcceptance \? \(/);
  assert.match(body, /コメントを投稿するには利用規約への同意が必要です/);
  assert.match(body, /href=\{rulesHref\}/);
  assert.ok(
    body.indexOf("needsTermsAcceptance ? (") < body.indexOf("!canPost ? ("),
    "TOS guard must run before X ID approval messaging",
  );
});

test("チャプター投稿成功後はprivate viewer overlay cacheを即時無効化する", () => {
  const body = read("ChapterCommentPanel.tsx");
  assert.match(body, /notifyVideoViewerOverlayChanged/);
  const successIndex = body.indexOf("const handleSuccess");
  const invalidateIndex = body.indexOf("notifyVideoViewerOverlayChanged(videoId)", successIndex);
  const submittedIndex = body.indexOf("setSubmittedChapter(chapter)", successIndex);
  assert.ok(
    successIndex >= 0 && invalidateIndex > successIndex && submittedIndex > invalidateIndex,
  );
  assert.match(body, /\[videoId\]/);
});

test("usePlayerTime delegates to subscribePlayerTime cleanup", () => {
  const body = read("usePlayerTime.ts");
  assert.match(body, /return subscribePlayerTime/);
});
