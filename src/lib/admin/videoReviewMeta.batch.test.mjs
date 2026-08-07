import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const metaSource = await readFile(
  new URL("./videoReviewMeta.ts", import.meta.url),
  "utf8");

test("fetchVideoReviewSummaries uses batch stage permission reader", () => {
  assert.match(metaSource, /batchReadStagePermissionCustomAnswers/);
  assert.doesNotMatch(metaSource, /readStagePermissionCustomAnswers/);
  assert.doesNotMatch(
    metaSource,
    /await readStagePermissionCustomAnswers/,
  );
});
