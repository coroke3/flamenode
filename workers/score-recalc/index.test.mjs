import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeScoreCursor,
  SCORE_FORCE_REFRESH_SEC,
  SCORE_RECALC_BATCH_SIZE,
} from "./index.ts";

test("スコア更新は1回500件以下に固定する", () => {
  assert.equal(SCORE_RECALC_BATCH_SIZE, 500);
  assert.equal(SCORE_FORCE_REFRESH_SEC, 24 * 60 * 60);
});

test("旧cursorは読み取り互換だけ維持する", () => {
  assert.equal(
    normalizeScoreCursor(JSON.stringify({ last_video_id: " video-2 " })),
    "video-2",
  );
  assert.equal(normalizeScoreCursor("broken"), "");
});
