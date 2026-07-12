import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("event mutationは質問数とD1 batch statement予算を事前制限する", () => {
  const source = read("src/lib/actions/event-admin.ts");
  const questionLimit = Number(
    source.match(/MAX_EVENT_CUSTOM_QUESTIONS\s*=\s*(\d+)/)?.[1],
  );
  const batchLimit = Number(
    source.match(/MAX_D1_ATOMIC_BATCH_STATEMENTS\s*=\s*(\d+)/)?.[1],
  );

  assert.equal(questionLimit, 18);
  assert.equal(batchLimit, 50);
  assert.match(source, /mutationCount\s*\*\s*2\s*\+\s*2\s*<=/);
  assert.match(source, /MAX_QUESTIONS_PER_INSERT\s*=\s*6/);
  assert.match(source, /questionInsertChunks\(questions\)/);
  assert.match(source, /questionInsertChunks\(insertedQuestions\)/);
  assert.match(source, /db\.insert\(eventCustomQuestions\)\.values\(chunk\)/);

  // 最悪ケース: event 1 + CAS update 17 + answer/question delete 2 +
  // multi-row insert 1 + queue 3 = 24 mutation。assertionとauditを含め50以内。
  const worstMutationCount = 1 + (questionLimit - 1) + 2 + 1 + 3;
  assert.equal(worstMutationCount * 2 + 2, batchLimit);
});

test("event question同期は回答を一括取得・削除し完全snapshotとCASを持つ", () => {
  const source = read("src/lib/actions/event-admin.ts");

  assert.match(
    source,
    /inArray\(videoCustomAnswers\.question_id, obsoleteQuestionIds\)/,
  );
  assert.match(
    source,
    /before:\s*\{\s*rows:\s*deletedAnswers\s*\}[\s\S]*after:\s*\{\s*rows:\s*\[\]\s*\}/,
  );
  assert.match(
    source,
    /eq\(eventCustomQuestions\.updated_at, row\.updated_at\)/,
  );
  assert.doesNotMatch(source, /const answerCount = \(await db\.select/);
});

test("manage video statusは完全row監査、updated_at CAS、有限queueを使う", () => {
  const action = read("src/lib/actions/manage-video.ts");
  const hooks = read("src/lib/staticRebuild/hooks.ts");

  assert.match(action, /eq\(videos\.updated_at, target\.updated_at\)/);
  assert.match(action, /before:\s*\{ \.\.\.target \}, after:\s*\{ \.\.\.after \}/);
  assert.match(action, /reason:\s*reason \|\| null/);
  assert.match(action, /context:\s*`manage-video-status:\$\{eventId\}`/);
  assert.doesNotMatch(action, /manage_event_id/);
  assert.match(
    action,
    /\.limit\(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS \+ 1\)/,
  );

  assert.match(hooks, /MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS\s*=\s*8/);
  assert.match(hooks, /inArray\(staticRebuildQueue\.target_id, eventIds\)/);
  assert.match(hooks, /activeByEventId/);
});
