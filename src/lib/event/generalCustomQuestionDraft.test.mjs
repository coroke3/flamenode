import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const draftSource = await readFile(
  new URL("./generalCustomQuestionDraft.ts", import.meta.url),
  "utf8",
);
const planSource = await readFile(
  new URL("./generalCustomQuestionPlan.ts", import.meta.url),
  "utf8",
);
const limitsSource = await readFile(
  new URL("./eventLimits.ts", import.meta.url),
  "utf8",
);

test("empty draft factory avoids stage_permission keys and defaults to textarea", () => {
  assert.match(draftSource, /question_key: `q_\$\{suffix\}`/);
  assert.match(draftSource, /generateId\(\)/);
  assert.doesNotMatch(draftSource, /Math\.random/);
  assert.match(draftSource, /type: "textarea"/);
  assert.doesNotMatch(draftSource, /question_key: `stage_permission/);
});

test("form reader drops stage keys and parses newline options", () => {
  assert.match(draftSource, /isStagePermissionQuestionKey\(question_key\)/);
  assert.match(draftSource, /normalizeOptionList/);
  assert.match(draftSource, /parseQuestionType/);
});

test("planned rows require options for choice types and keep review visibility", () => {
  assert.match(planSource, /questionTypeNeedsOptions\(type\) && !optionsJson/);
  assert.match(planSource, /visibility: "review"/);
  assert.match(planSource, /isStagePermissionQuestionKey\(key\)/);
  assert.match(planSource, /serializeOptionsJson/);
});

test("cap never goes below MAX_GENERAL_CUSTOM_QUESTIONS", () => {
  assert.match(limitsSource, /MAX_GENERAL_CUSTOM_QUESTIONS = 4/);
  assert.match(planSource, /Math\.max\(\s*MAX_GENERAL_CUSTOM_QUESTIONS/);
});
