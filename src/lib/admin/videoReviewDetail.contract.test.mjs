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

test("無効質問は回答が残っている場合だけ審査画面へ残す", () => {
  assert.match(
    detail,
    /question\.is_active === 1 \|\| answerMap\.has\(question\.id\)/,
  );
});
