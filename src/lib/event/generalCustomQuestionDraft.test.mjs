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
  new URL("../../../packages/domain/src/event/limits.ts", import.meta.url),
  "utf8",
);
const capSource = await readFile(
  new URL("../../../packages/domain/src/event/generalQuestionCap.ts", import.meta.url),
  "utf8",
);

const draftDomainSource = await readFile(
  new URL("../../../packages/domain/src/event/generalQuestionDraft.ts", import.meta.url),
  "utf8",
);

test("MIG-0652 U01: custom-question projection uses a domain bridge", () => {
  assert.match(draftSource, /export \\{ customQuestionToDraft \\} from "@flamenode\\/domain\\/event"/);
  assert.doesNotMatch(draftSource, /export function customQuestionToDraft\\(/);
  assert.match(draftDomainSource, /export function customQuestionToDraft\\(/);
  assert.doesNotMatch(draftDomainSource, /from ["']@\\//);
});

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
  assert.match(capSource, /Math\.max\(\s*MAX_GENERAL_CUSTOM_QUESTIONS/);
  assert.match(planSource, /export \{ resolveGeneralCustomQuestionCap \} from "@flamenode\/domain\/event"/);
});
