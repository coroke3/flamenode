import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const action = read("./chapter.ts");
const composer = read("../../components/video/ChapterComposer.tsx");
const item = read("../../components/video/ChapterCommentItem.tsx");
const tabs = read("../../components/video/ChapterTabs.tsx");

test("通常チャプターの作成と削除は監査・静的再生成を同一mutationで保存する", () => {
  assert.equal((action.match(/await mutateWithAudit\(db,/g) ?? []).length, 2);
  assert.equal(
    (action.match(/await buildStaticRebuildQueueBatch\(/g) ?? []).length,
    2,
  );
  assert.match(action, /operation: "CREATE"/);
  assert.match(action, /operation: "DELETE"/);
});

test("チャプター削除はvideo_chaptersの物理削除とCASを使う", () => {
  assert.match(action, /\.delete\(videoChapters\)/);
  assert.match(
    action,
    /expectedRowCondition\(\{ expectedCurrent: existing \}\)/,
  );
  assert.doesNotMatch(action, /deleted_at|is_deleted|soft_delete/i);
});

test("動画時間が未取得または範囲外なら投稿を拒否する", () => {
  assert.match(action, /videoYoutubeMetadata\.duration_seconds/);
  assert.match(action, /durationSeconds == null \|\| durationSeconds <= 0/);
  assert.match(action, /data\.chapter_time > durationSeconds/);
  assert.match(composer, /getChapterPostingContext/);
  assert.match(composer, /parsedTime > durationSeconds/);
});

test("通常チャプターのCSV一括登録は撤去されている", () => {
  assert.doesNotMatch(action, /createChaptersBulk|parseChapterBulkCsv/);
  assert.doesNotMatch(composer, /createChaptersBulk|CSV で一括登録|bulkCsv/);
});

test("削除操作は権限取得後だけ表示し専用確認ダイアログを使う", () => {
  assert.match(action, /getChapterDeleteCapabilities/);
  assert.match(tabs, /await getChapterDeleteCapabilities\(ids\)/);
  assert.match(tabs, /canDelete=\{deletableIds\.has\(chapter\.id\)\}/);
  assert.match(tabs, /role="alertdialog"/);
  assert.match(tabs, /await deleteChapter\(formData\)/);
  assert.doesNotMatch(item, /window\.confirm|deleteChapter/);
  assert.doesNotMatch(tabs, /window\.confirm/);
});

test("シーク領域と削除ボタンを別のbuttonとして描画する", () => {
  assert.match(item, /className=\{styles\.seekTarget\}/);
  assert.match(item, /className=\{styles\.deleteButton\}/);
  assert.match(item, /name="trash"/);
});

test("公開範囲は説明付きのradio選択になっている", () => {
  assert.match(composer, /name="chapter_visibility"/);
  assert.match(composer, /type="radio"/);
  assert.match(composer, /自分と作品管理者だけに表示します/);
});
