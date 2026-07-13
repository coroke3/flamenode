import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCORE_FORCE_REFRESH_SEC,
  SCORE_RECALC_BATCH_SIZE,
} from "./index.ts";

test("スコア更新は1回150件以下に固定する", () => {
  assert.equal(SCORE_RECALC_BATCH_SIZE, 150);
  assert.equal(SCORE_FORCE_REFRESH_SEC, 24 * 60 * 60);
});
