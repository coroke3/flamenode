import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./CustomQuestionFields.tsx", import.meta.url),
  "utf8",
);

test("CustomQuestionFields renders typed inputs without posting names in preview", () => {
  assert.match(source, /type === "radio"/);
  assert.match(source, /type === "checkbox"/);
  assert.match(source, /styles\.customChoiceGroup/);
  assert.match(source, /styles\.customChoiceOption/);
  assert.match(source, /const fieldName = preview \? undefined : name/);
  assert.match(source, /questionTypeNeedsOptions/);
  assert.match(source, /validateRequiredCustomQuestions/);
  assert.match(source, /selectedValue/);
  assert.match(source, /この質問の選択肢がまだ設定されていません/);
  assert.doesNotMatch(
    source,
    /questionTypeNeedsOptions\(type\) && choiceOptions\.length === 0 && preview/,
  );
});
