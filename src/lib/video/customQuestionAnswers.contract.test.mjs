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
    /chunkValues\(existing, CUSTOM_ANSWER_DELETE_CHUNK_SIZE\)/,
  );
  assert.match(
    source,
    /expectedChanges\.push\(deleteChunk\.length\)/,
  );
});

test("現在回答と解除イベント回答は監査対象IDで重複排除する", () => {
  assert.match(source, /const existingByTarget = new Map/);
  assert.match(
    source,
    /compositeAuditTargetId\(row\.video_id, row\.event_id, row\.question_id\)/,
  );
});
