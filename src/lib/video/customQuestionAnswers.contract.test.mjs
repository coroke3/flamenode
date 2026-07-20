import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./customQuestionAnswers.ts", import.meta.url)),
  "utf8",
);

test("カスタム回答のCAS削除は8行単位に分割する", () => {
  assert.match(
    source,
    /CUSTOM_ANSWER_DELETE_CHUNK_SIZE = MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS/,
  );
  assert.match(
    source,
    /chunkValues\(stale, CUSTOM_ANSWER_DELETE_CHUNK_SIZE\)/,
  );
  assert.match(
    source,
    /expectedChanges\.push\(deleteChunk\.length\)/,
  );
});

test("現在回答と解除イベント回答は監査対象IDで重複排除する", () => {
  assert.match(source, /const existingByTarget = new Map/);
  assert.match(source, /answerTargetId\(row\)/);
});

test("回答更新は登録日時を保持し、変更行だけUPSERTする", () => {
  assert.match(
    source,
    /created_at: current\?\.created_at \?\? args\.now/,
  );
  assert.match(source, /const changed = next\.filter/);
  assert.match(source, /onConflictDoUpdate/);
  assert.match(source, /updated_at: sql`excluded\.updated_at`/);
});

test("回答監査は作成・更新・削除を実際の差分に合わせる", () => {
  assert.match(
    source,
    /operation: current \? "UPDATE" as const : "CREATE" as const/,
  );
  assert.match(
    source,
    /operation: "DELETE" as const/,
  );
  assert.doesNotMatch(
    source,
    /chunkValues\(existing, CUSTOM_ANSWER_DELETE_CHUNK_SIZE\)/,
  );
});

test("履歴読み取りは8件の書き込み上限と分離する", () => {
  assert.match(
    source,
    /MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ =\s*MAX_ATOMIC_VIDEO_EVENTS \* MAX_EVENT_CUSTOM_QUESTIONS/,
  );
  assert.match(
    source,
    /questions\.length > MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ/,
  );
  assert.match(
    source,
    /limit\(MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ \+ 1\)/,
  );
});

test("複数イベント解除時は履歴上限まで回答を読み、8件ずつ削除する", () => {
  assert.match(
    source,
    /const removedEventAnswers =[\s\S]*?limit\(MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ \+ 1\)/,
  );
  assert.match(
    source,
    /removedEventAnswers\.length > MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ/,
  );
});
