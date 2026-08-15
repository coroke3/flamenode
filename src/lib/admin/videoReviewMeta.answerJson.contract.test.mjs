import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [source, detailSource] = await Promise.all([
  readFile(new URL("./videoReviewMeta.ts", import.meta.url), "utf8"),
  readFile(new URL("./videoReviewDetail.ts", import.meta.url), "utf8"),
]);

test("required review answers count answer_json-backed checkbox values", () => {
  assert.match(source, /videoCustomAnswers\.answer_json/);
  assert.match(source, /NOT IN \('\[\]', '\{\}', 'null', '\"\"'\)/);
  assert.match(detailSource, /answer_json: videoCustomAnswers\.answer_json/);
  assert.match(detailSource, /formatVideoReviewAnswer\(/);
});
