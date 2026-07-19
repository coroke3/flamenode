import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const action = read("./chapter.ts");
const composer = read("../../components/video/ChapterComposer.tsx");
const item = read("../../components/video/ChapterCommentItem.tsx");

test("通常チャプターの作成と削除は監査・静的再生成を同一mutationで保存する", () => {
  assert.equal((action.match(/await mutateWithAudit\(db,/g) ?? []).length, 2);
  assert.equal(
    (action.match(/await buildStaticRebuildQueueBatch\(db,/g) ?? []).length,
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
});

test("通常チャプターのCSV一括登録は撤去されている", () => {
  assert.doesNotMatch(action, /createChaptersBulk|parseChapterBulkCsv/);
  assert.doesNotMatch(composer, /createChaptersBulk|CSV で一括登録|bulkCsv/);
});

test("通常画面のコメント項目から削除Server Actionを呼び出す", () => {
  assert.match(item, /import \{ deleteChapter \}/);
  assert.match(item, /formData\.set\("chapter_id", chapter\.id\)/);
  assert.match(item, /await deleteChapter\(formData\)/);
  assert.match(item, /window\.confirm/);
});
