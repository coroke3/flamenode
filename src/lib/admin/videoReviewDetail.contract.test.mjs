import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function read(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const detail = read("./videoReviewDetail.ts");
const managePage = read("../../../app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx");
const adminPage = read("../../../app/(admin)/admin/videos/[id]/page.tsx");

test("管理者詳細は全所属イベントをvideo_eventsから解決する", () => {
  assert.match(detail, /from\(videoEvents\)/);
  assert.match(detail, /resolveReviewEventIds/);
  assert.match(adminPage, /fetchVideoReviewDetail\(db, id\)/);
});

test("明示イベントと主イベント補完後の件数を同じ上限で検証する", () => {
  assert.match(detail, /function assertReviewEventLimit/);
  assert.match(
    detail,
    /if \(explicit\.length > 0\) \{[\s\S]*?assertReviewEventLimit\(explicit\)/,
  );
  assert.match(
    detail,
    /if \(primaryEventId && !linked\.includes\(primaryEventId\)\) linked\.unshift\(primaryEventId\);[\s\S]*?assertReviewEventLimit\(linked\)/,
  );
});

test("イベント運営にはreviewとpublicの質問だけを表示する", () => {
  assert.match(
    managePage,
    /fetchVideoReviewDetail\(db, videoId, \[id\], "review"\)/,
  );
  assert.match(
    detail,
    /inArray\(eventCustomQuestions\.visibility, \["review", "public"\]\)/,
  );
});

test("多数の過去質問回答はD1バインド上限内に分割して読む", () => {
  assert.match(
    detail,
    /CUSTOM_ANSWER_QUESTION_ID_BATCH_SIZE = 80/,
  );
  assert.match(
    detail,
    /chunkValues\([\s\S]*?questions\.map\(\(question\) => question\.id\)[\s\S]*?CUSTOM_ANSWER_QUESTION_ID_BATCH_SIZE/,
  );
  assert.match(
    detail,
    /limit\(questionIdChunk\.length \+ 1\)/,
  );
  assert.match(
    detail,
    /video_review_answer_limit_exceeded/,
  );
});

test("無効質問は回答が残っている場合だけ審査画面へ残す", () => {
  assert.match(
    detail,
    /question\.is_active === 1 \|\| answerMap\.has\(question\.id\)/,
  );
});

test("複数イベント回答は内部IDではなくイベント名で識別する", () => {
  assert.match(detail, /select\(\{ id: events\.id, title: events\.title \}\)/);
  assert.match(detail, /eventTitleById\.get\(question\.event_id\)/);
});
